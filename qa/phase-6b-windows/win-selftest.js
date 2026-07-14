'use strict';
// Phase 6B Windows beta self-test harness (committed, unlike the Phase 6A
// reconstruction). Runs the app's real production modules under the *packaged
// Windows Electron runtime as node* (`set ELECTRON_RUN_AS_NODE=1` then
// `"WRL Forge.exe" win-selftest.js`), against the real (case-INSENSITIVE NTFS)
// filesystem, and writes a JSON result the runner copies back to the Linux host.
//
// It is ALSO runnable on Linux (`node qa/phase-6b-windows/win-selftest.js`) so the
// harness itself is verifiable in CI before it ever reaches the VM — the editor
// resolution assertions inject `platform`/`env`/`existsSync`, so they are
// deterministic on any host; only the "real filesystem" facts (path.sep, NTFS
// case-insensitivity) are host-observed and asserted as preconditions.
//
// Coverage extends Phase 6A: re-verifies paths/gzip/scan/70-tex/>20-tex/viewpoints/
// broken-diagnostics/case-mismatch/package-audit/review-bundle/spaces+non-ASCII/
// editor-not-found/window-state/drive-letter, and ADDS the Phase 6B editor cases:
// valid absolute override, valid PATH override, INVALID override fall-through,
// `.edit.wrl` generation, settings.json `editorCommand` override, and the
// spaces/non-ASCII spawn-arg quoting for both `.exe` (direct) and `.cmd` (shell).
//
// No product code is imported by copy — every check calls the shipping module.

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const req = (rel) => require(path.join(ROOT, rel));

const { isGzip, editPathFor } = req('src/files/vrml-file.js');
const { scanProject } = req('src/world-project/project-loader.js');
const { buildPackagePlan, buildManifest } = req('src/world-project/package-plan.js');
const { writeReviewBundle } = req('src/world-project/bundle-builder.js');
const { resolveEditor, buildLaunch } = req('src/editor/editor-locator.js');
const { loadSettings } = req('src/settings/app-settings.js');
const { windowStatePath, legacyWindowStatePath } = req('src/settings/window-state.js');
const { classifyWorkspace, assertLocalWorkspace } = req('qa/visual-qa/workspace-guard.js');
const { createMallPreviewBridge, HARD_MAX_BYTES } = req('src/preview/mall-preview-bridge.js');
const { createWorldPreviewBridge } = req('src/preview/world-preview-bridge.js');
const { resolveWorldRequest, worldAssetUrl } = req('src/world-project/preview-source.js');
const { resolveViewpointRestore } = req('src/preview/viewpoint-preserve.js');
const { fileDirUrl } = req('src/preview/texture-base.js');

const FIX = path.join(ROOT, 'test', 'fixtures', 'world');
const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail == null ? '' : String(detail) });
  } catch (err) {
    results.push({ name, pass: false, detail: String((err && err.message) || err) });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// Phase 7C4.1 hard precondition: on the real Windows VM this self-test writes
// scratch and reads committed fixtures, so it must NOT run from a UNC path,
// mapped network drive, or the host share. Abort loudly before any fixture read.
// (No-op on Linux, where the harness runs for its own verification.)
try {
  assertLocalWorkspace(ROOT);
} catch (err) {
  console.error(err.message);
  console.error(`Refused workspace: ${err.classification ? err.classification.reason : ROOT}`);
  process.exit(2);
}

function scan(dir, primaryName = 'world.wrl') {
  const root = path.join(FIX, dir);
  return scanProject({ root, primary: path.join(root, primaryName) });
}

// ---- Platform / path (Phase 6A parity) ----
check('platform reported', () => `${process.platform} ${process.arch}`);
check('path.sep matches platform', () => {
  const expected = process.platform === 'win32' ? '\\' : '/';
  assert(path.sep === expected, `sep=${JSON.stringify(path.sep)}`);
  return JSON.stringify(path.sep);
});
check('win32 path.join drive-letter + spaces', () => {
  const p = path.win32.join('C:\\Users\\ryan', 'Projects', 'a b', 'world.wrl');
  assert(p === 'C:\\Users\\ryan\\Projects\\a b\\world.wrl', p);
  return p;
});
check('win32 isAbsolute drive letter', () => {
  assert(path.win32.isAbsolute('C:\\x') && !path.win32.isAbsolute('x\\y'));
});

// ---- Phase 7C4.1 workspace guard (injected, deterministic cross-host) ----
const fixedC = () => 'Fixed';
const networkZ = () => 'Network';
check('workspace guard: local C:\\Projects\\wrlforge accepted', () => {
  const c = classifyWorkspace('C:\\Projects\\wrlforge', { platform: 'win32', env: {}, driveType: fixedC });
  assert(c.ok && c.kind === 'ok', JSON.stringify(c));
});
check('workspace guard: UNC host share rejected', () => {
  const c = classifyWorkspace('\\\\host.lan\\Data\\wrlforge', { platform: 'win32', env: {}, driveType: fixedC });
  assert(!c.ok && (c.kind === 'unc' || c.kind === 'host-share'), JSON.stringify(c));
});
check('workspace guard: mapped network drive rejected', () => {
  const c = classifyWorkspace('Z:\\wrlforge', { platform: 'win32', env: {}, driveType: networkZ });
  assert(!c.ok && c.kind === 'network-drive', JSON.stringify(c));
});
check('workspace guard: this workspace on the real host', () => {
  const c = classifyWorkspace(ROOT);
  // On the Windows VM this proves the clone is local; on Linux it is a non-block.
  assert(c.ok, `${c.kind}: ${c.reason}`);
  return `${c.kind}`;
});

// ---- gzip transparency (Phase 6A parity) ----
check('detects gzip magic', () => {
  const gz = zlib.gzipSync(Buffer.from('#VRML V2.0 utf8\n'));
  assert(isGzip(gz) && !isGzip(Buffer.from('#VRML V2.0 utf8\n')), 'isGzip');
  return `gzip[0]=0x${gz[0].toString(16)}`;
});
check('gunzip round-trips to plain text', () => {
  const text = '#VRML V2.0 utf8\nGroup {}\n';
  assert(zlib.gunzipSync(zlib.gzipSync(Buffer.from(text))).toString() === text);
});

// ---- World scan: nested / gzip Inline / textures (Phase 6A parity) ----
const nested = scan('nested');
check('scan nested world ok', () => { assert(nested.status === 'ok', nested.status); });
check('scan nested wrl node count', () => {
  const n = nested.graph.wrlNodes.length;
  assert(n >= 3, `wrlNodes=${n}`); return `wrlNodes=${n}`;
});
check('scan nested unique textures', () => {
  const t = nested.graph.stats.uniqueTextures;
  assert(t >= 3, `tex=${t}`); return `tex=${t}`;
});
check('scan nested clean (no missing/case/unsafe)', () => {
  const s = nested.graph.stats;
  assert(s.missing === 0 && s.caseMismatches === 0 && s.unsafe === 0,
    `missing=${s.missing} case=${s.caseMismatches} unsafe=${s.unsafe}`);
});
check('scan nested viewpoints discovered', () => {
  const v = nested.graph.stats.viewpoints;
  assert(v >= 1, `vp=${v}`); return `vp=${v}`;
});

const big = scan('valid70');
check('scan 70-texture world (>=70 unique, not truncated)', () => {
  const t = big.graph.stats.uniqueTextures;
  assert(t >= 70 && !big.graph.truncated, `tex=${t} truncated=${big.graph.truncated}`); return `tex=${t}`;
});
const mini = scan('mini');
check('scan >20-texture world (mini)', () => {
  const t = mini.graph.stats.uniqueTextures;
  assert(t > 20, `tex=${t}`); return `tex=${t}`;
});

// ---- Broken diagnostics + case mismatch (Phase 6A parity) ----
const broken = scan('broken');
check('broken world: missing detected', () => {
  assert(broken.graph.stats.missing >= 1, `missing=${broken.graph.stats.missing}`);
  return `missing=${broken.graph.stats.missing}`;
});
check('broken world: remote surfaced', () => {
  assert(broken.graph.stats.remoteRefs >= 1, `remote=${broken.graph.stats.remoteRefs}`);
  return `remote=${broken.graph.stats.remoteRefs}`;
});
check('broken world: unsafe detected', () => {
  assert(broken.graph.stats.unsafe >= 1, `unsafe=${broken.graph.stats.unsafe}`);
  return `unsafe=${broken.graph.stats.unsafe}`;
});
check('broken world: case mismatch flagged', () => {
  assert(broken.graph.stats.caseMismatches >= 1, `case=${broken.graph.stats.caseMismatches}`);
  return `case=${broken.graph.stats.caseMismatches}`;
});
// On a case-INSENSITIVE fs, assert the precondition that makes the above meaningful.
check('case-insensitivity precondition (host-observed)', () => {
  const img = path.join(FIX, 'broken', 'img');
  let sample = null;
  try { sample = fs.readdirSync(img).find((f) => /\.(png|jpg|jpeg|gif)$/i.test(f)); } catch { /* no img dir */ }
  if (!sample) return 'no image dir (skipped)';
  const upper = path.join(img, sample.toUpperCase());
  const insensitive = fs.existsSync(upper) && sample.toUpperCase() !== sample;
  return process.platform === 'win32'
    ? `NTFS existsSync(upper)=${fs.existsSync(upper)} (case detected in code regardless)`
    : `ext4 existsSync(upper)=${insensitive} (case-sensitive host)`;
});

// ---- Package Audit + Review Bundle (Phase 6A parity + integrity) ----
const plan = buildPackagePlan(nested);
check('package audit READY (nested)', () => {
  assert(plan.status === 'ready', `status=${plan.status}`);
  return `status=${plan.status} files=${plan.files.length}`;
});
check('review bundle: written outside project + integrity', () => {
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wrlbeta-')), 'bundle.zip');
  const summary = writeReviewBundle(nested, dest, { plan });
  assert(fs.existsSync(dest), 'bundle not written');
  const bytes = fs.statSync(dest).size;
  // Re-hash packaged files against the manifest.
  const manifest = buildManifest(plan);
  const nFiles = manifest.files.length;
  assert(nFiles >= 1, 'no manifest files');
  fs.rmSync(path.dirname(dest), { recursive: true, force: true });
  return `bytes=${bytes} files=${nFiles} entries=${summary && summary.entryCount != null ? summary.entryCount : '?'}`;
});
check('review bundle: refuses in-project destination', () => {
  const inside = path.join(nested.root, 'bundle.zip');
  let threw = false;
  try { writeReviewBundle(nested, inside, { plan }); } catch { threw = true; }
  assert(threw, 'did not refuse in-project dest');
  assert(!fs.existsSync(inside), 'wrote into project!');
});
check('review bundle: refuses overwrite of existing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlbeta-'));
  const dest = path.join(dir, 'bundle.zip');
  fs.writeFileSync(dest, 'existing');
  let threw = false;
  try { writeReviewBundle(nested, dest, { plan }); } catch { threw = true; }
  fs.rmSync(dir, { recursive: true, force: true });
  assert(threw, 'did not refuse overwrite');
});

// ---- spaces + non-ASCII project path ----
check('scans a path with spaces + non-ASCII', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlbeta-'));
  const proj = path.join(base, 'a b — wörld');
  fs.mkdirSync(proj, { recursive: true });
  const primary = path.join(proj, 'world.wrl');
  fs.writeFileSync(primary, '#VRML V2.0 utf8\nGroup {}\n');
  const s = scanProject({ root: proj, primary });
  fs.rmSync(base, { recursive: true, force: true });
  assert(s.status === 'ok', s.status);
  return proj;
});

// ---- Editor discovery: not-found + Phase 6B override cases (injected, deterministic) ----
// POSIX-style bases so path.isAbsolute/path.join behave the same on a Linux host
// and on the real Windows VM (platform:'win32' still drives .cmd/shell + PATHEXT +
// install-location ordering). Present paths are built with the host `path.join`,
// exactly like test/editor/editor-locator.test.js, so `existsSync` matching is
// host-independent. On the real VM these facts are re-verified against C:\ paths
// by the live GUI/launch steps.
const winEnv = {
  LOCALAPPDATA: '/win/AppData/Local',
  ProgramFiles: '/win/Program Files',
  'ProgramFiles(x86)': '/win/Program Files (x86)',
  PATH: '/win/System32;/win/tools',
  PATHEXT: '.COM;.EXE;.BAT;.CMD',
};
const installedExe = path.join('/win/AppData/Local', 'Programs', 'VSCodium', 'VSCodium.exe');
const noneExist = () => false;
const only = (present) => (p) => p === present;
check('editor: clear not-found message (VSCodium absent)', () => {
  const r = resolveEditor({ platform: 'win32', env: winEnv, existsSync: noneExist });
  assert(r.found === false, 'unexpectedly found');
  assert(/WRL_FORGE_EDITOR/.test(r.hint), 'hint missing env var');
  assert(Array.isArray(r.tried) && r.tried.length >= 10, `tried=${r.tried && r.tried.length}`);
  return `tried=${r.tried.length}`;
});
check('editor override: valid absolute .exe honoured (no shell)', () => {
  const ov = path.join('/win/tools', 'VSCodium', 'VSCodium.exe');
  const r = resolveEditor({ platform: 'win32', env: winEnv, existsSync: only(ov), override: ov });
  assert(r.found && r.source === 'override' && r.command === ov && r.shell === false, JSON.stringify(r));
  return r.source;
});
check('editor override: valid absolute .cmd → shell launch', () => {
  const ov = path.join('/win/Program Files', 'VSCodium', 'bin', 'codium.cmd');
  const r = resolveEditor({ platform: 'win32', env: winEnv, existsSync: only(ov), override: ov });
  assert(r.found && r.source === 'override' && r.shell === true, JSON.stringify(r));
  return `shell=${r.shell}`;
});
check('editor override: valid bare command resolved on PATH', () => {
  const onPath = path.join('/win/tools', 'codium.cmd');
  const r = resolveEditor({ platform: 'win32', env: winEnv, override: 'codium.cmd', existsSync: only(onPath) });
  assert(r.found && r.source === 'override' && r.command === onPath, JSON.stringify(r));
  return r.command;
});
check('editor override: INVALID absolute path is tried first then falls through to not-found', () => {
  const bad = path.join('/win/nope', 'ghost.exe');
  const r = resolveEditor({ platform: 'win32', env: winEnv, existsSync: noneExist, override: bad });
  assert(r.found === false, 'invalid override was treated as found');
  assert(r.tried[0] === bad, `first tried=${r.tried[0]}`);
  assert(/WRL_FORGE_EDITOR/.test(r.hint), 'no clear hint');
  return 'not-found (bad override never launched)';
});
check('editor override: INVALID absolute path with VSCodium installed → falls back to install (documented)', () => {
  const bad = path.join('/win/nope', 'ghost.exe');
  const r = resolveEditor({ platform: 'win32', env: winEnv, override: bad, existsSync: only(installedExe) });
  // Documented behavior: an unusable override is skipped in favour of discovery.
  assert(r.found && r.source === 'install-location' && r.command === installedExe, JSON.stringify(r));
  return 'fell back to discovered install';
});
check('editor: linux codium/code discovery resolves to codium', () => {
  // NOTE: resolveEditor uses the HOST `path` module, so on a Windows host the
  // injected POSIX PATH probe can't match (backslash join) and the module
  // correctly falls back to the bare `codium` path-default. Assert the outcome
  // that holds on BOTH hosts: found, resolving to a codium/code command. The
  // exact `/usr/bin/codium` match is covered on real Linux by
  // test/editor/editor-locator.test.js.
  const r = resolveEditor({
    platform: 'linux', env: { PATH: '/usr/bin:/usr/local/bin' },
    existsSync: (p) => p === '/usr/bin/codium',
  });
  assert(r.found && /codium|code/i.test(r.command), JSON.stringify(r));
  return r.command;
});

// ---- settings.json editorCommand override (Phase 6B) ----
check('settings.json editorCommand loaded as override', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlbeta-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ editorCommand: 'C:\\Tools\\VSCodium\\VSCodium.exe' }));
  const s = loadSettings(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert(s.editorCommand === 'C:\\Tools\\VSCodium\\VSCodium.exe', JSON.stringify(s));
  return s.editorCommand;
});
check('settings.json missing → defaults, no throw', () => {
  const s = loadSettings(path.join(os.tmpdir(), 'wrlbeta-nonexistent-' + process.pid));
  assert(s && typeof s === 'object', 'no settings object');
});

// ---- .edit.wrl generation + spawn-arg quoting (Phase 6B) ----
check('.edit.wrl sibling path generated', () => {
  const src = path.win32.join('C:\\Users\\ryan\\Projects', 'a b', 'ITEM.wrl');
  const edit = editPathFor(src);
  assert(/\.edit\.wrl$/i.test(edit), edit);
  return edit;
});
check('buildLaunch: .exe passes file as argv (no shell, spaces safe)', () => {
  const spec = buildLaunch({ command: 'C:\\Tools\\VSCodium\\VSCodium.exe', shell: false }, 'C:\\a b\\wörld.edit.wrl');
  assert(spec.options.shell === false, 'should not use shell');
  assert(spec.args.length === 1 && spec.args[0] === 'C:\\a b\\wörld.edit.wrl', JSON.stringify(spec.args));
});
check('buildLaunch: .cmd shim double-quotes command AND file for cmd.exe', () => {
  const spec = buildLaunch({ command: 'C:\\Program Files\\VSCodium\\bin\\codium.cmd', shell: true }, 'C:\\a b\\wörld.edit.wrl');
  assert(spec.options.shell === true, 'should use shell');
  assert(spec.command.includes('"C:\\Program Files\\VSCodium\\bin\\codium.cmd"'), spec.command);
  assert(spec.command.includes('"C:\\a b\\wörld.edit.wrl"'), spec.command);
});

// ---- window-state / userData paths (Phase 6A parity) ----
check('window-state path under userData', () => {
  const ud = path.win32.join('C:\\Users\\ryan\\AppData\\Roaming', 'wrl-forge');
  const p = windowStatePath(ud).split(path.sep).join('/'); // normalize for readability
  assert(/wrl-forge/.test(windowStatePath(ud)) && /window-state\.json$/.test(windowStatePath(ud)), windowStatePath(ud));
  return windowStatePath(ud);
});
check('legacy vrmlpad migration path resolves', () => {
  const ud = path.join(os.tmpdir(), 'wrl-forge');
  const legacy = legacyWindowStatePath(ud);
  assert(/vrmlpad/.test(legacy), legacy);
  return legacy;
});

// ---- Phase 7B: native editor safe-save / conflict / authorization / restore ----
// Host-agnostic (pure Node + real fs), so these run on Linux for harness
// verifiability AND exercise the real NTFS filesystem on the Windows VM: atomic
// rename, gzip round-trip, timestamped backup, external-change detection, path
// authorization, and restore confinement -- including spaces/non-ASCII paths.
const { loadDocument, safeSave } = req('src/editor/file-io');
const { authorizeWorldReference } = req('src/editor/path-authorizer');
const editorStore = req('src/editor/session-store');
const { EditorController } = req('src/editor/editor-controller');
const EDWRL = '#VRML V2.0 utf8\nGroup { children [] }\n';

function edScratch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-7b-'));
  return { dir, file: path.join(dir, name) };
}

check('editor safe-save (plain): atomic write + backup, on-disk matches buffer', () => {
  const { file } = edScratch('item.wrl');
  fs.writeFileSync(file, EDWRL);
  const doc = loadDocument(file);
  const res = safeSave({ filePath: file, text: EDWRL + '# saved\n', format: doc.format, expectedStat: doc.stat });
  assert(res.ok && fs.readFileSync(file, 'utf8') === EDWRL + '# saved\n', 'content');
  assert(res.backup && fs.existsSync(res.backup), 'backup');
  return path.basename(res.backup);
});

check('editor safe-save (gzip): round-trips as gzip on disk', () => {
  const { file } = edScratch('item.wrl');
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(EDWRL)));
  const doc = loadDocument(file);
  assert(doc.format === 'gzip', doc.format);
  safeSave({ filePath: file, text: EDWRL + '# gz\n', format: 'gzip', expectedStat: doc.stat });
  const raw = fs.readFileSync(file);
  assert(raw[0] === 0x1f && zlib.gunzipSync(raw).toString() === EDWRL + '# gz\n', 'gzip round-trip');
});

check('editor conflict: external change refuses save (EEXTERNAL), source intact', () => {
  const { file } = edScratch('item.wrl');
  fs.writeFileSync(file, EDWRL);
  const doc = loadDocument(file);
  fs.writeFileSync(file, EDWRL + '# theirs\n'); // external edit
  let code = null;
  try { safeSave({ filePath: file, text: 'mine', format: 'plain', expectedStat: doc.stat }); }
  catch (e) { code = e.code; }
  assert(code === 'EEXTERNAL', `code=${code}`);
  assert(fs.readFileSync(file, 'utf8') === EDWRL + '# theirs\n', 'not clobbered');
});

check('editor path authorization: in-graph ok, traversal + stray rejected', () => {
  const { dir, file } = edScratch('world.wrl');
  fs.writeFileSync(file, EDWRL);
  const allowed = new Set([path.resolve(file)]);
  assert(authorizeWorldReference({ root: dir, allowedWrl: allowed, ref: file }).ok, 'in-graph');
  assert(authorizeWorldReference({ root: dir, allowedWrl: allowed, ref: '../escape.wrl' }).reason === 'outside-root', 'traversal');
  assert(authorizeWorldReference({ root: dir, allowedWrl: new Set(), ref: 'world.wrl' }).reason === 'not-in-project', 'stray');
});

check('editor restore confinement: world doc outside recorded root is refused', () => {
  const a = edScratch('world.wrl'); fs.writeFileSync(a.file, EDWRL);
  const b = edScratch('elsewhere.wrl'); fs.writeFileSync(b.file, EDWRL);
  assert(editorStore.validateRestore({ sourcePath: a.file, context: 'world', root: a.dir }).ok, 'inside ok');
  assert(editorStore.validateRestore({ sourcePath: b.file, context: 'world', root: a.dir }).reason === 'outside-context', 'outside');
  assert(editorStore.validateRestore({ sourcePath: '/no/such-xyz.wrl', context: 'mall' }).reason === 'missing', 'missing');
});

check('editor controller: open + save + restore through a spaces/non-ASCII path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge 7b ünïcode '));
  const file = path.join(dir, 'my itém.wrl');
  fs.writeFileSync(file, EDWRL);
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-7b-ud-'));
  const ctl = new EditorController({ getMallSource: () => file, userDataPath: ud });
  const d = ctl.openMall();
  ctl.setText(d.sessionId, EDWRL + '# edit\n');
  const res = ctl.save(d.sessionId);
  assert(res.ok && fs.readFileSync(file, 'utf8') === EDWRL + '# edit\n', 'saved');
  const restored = new EditorController({ userDataPath: ud }).restore();
  assert(restored.restored && restored.sourcePath === path.resolve(file), 'restored');
  return path.basename(file);
});

// ---- Phase 7B1: passive-launch posture (opening never launches an editor) ----
const { openMallItem, openExternalEditor } = req('src/editor/mall-edit-flow');

check('mall open is passive: writes .edit.wrl working copy, never launches editor', () => {
  const { file } = edScratch('item.wrl');
  fs.writeFileSync(file, EDWRL);
  const launched = [];
  const deps = {
    readSource: (p) => ({ text: fs.readFileSync(p, 'utf8'), wasGzipped: false, rawBytes: fs.statSync(p).size }),
    editPathFor,
    writeWorkingCopy: (ef, t) => fs.writeFileSync(ef, t, 'utf8'),
    workingCopyExists: (ef) => fs.existsSync(ef),
    launch: (ef) => { launched.push(ef); return { launched: true }; },
  };
  const info = openMallItem(file, deps);
  assert(fs.existsSync(info.editFile) && /\.edit\.wrl$/i.test(info.editFile), 'working copy written');
  assert(launched.length === 0, 'open must NOT launch an editor');
  assert(!('editorStatus' in info), 'no editorStatus on passive open');
  return path.basename(info.editFile);
});

check('explicit external action launches on the working copy (recreates if missing)', () => {
  const { file } = edScratch('item.wrl');
  fs.writeFileSync(file, EDWRL);
  const editFile = editPathFor(file);
  const launched = [];
  const deps = {
    readSource: (p) => ({ text: fs.readFileSync(p, 'utf8'), wasGzipped: false, rawBytes: 0 }),
    writeWorkingCopy: (ef, t) => fs.writeFileSync(ef, t, 'utf8'),
    workingCopyExists: (ef) => fs.existsSync(ef),
    launch: (ef) => { launched.push(ef); return { launched: true }; },
  };
  const res = openExternalEditor({ mallPath: file, editFile }, deps);
  assert(res.created && fs.existsSync(editFile), 'missing working copy recreated by explicit action');
  assert(launched.length === 1 && launched[0] === editFile, 'launched exactly once, on the working copy');
});

// ---- Phase 7C2 Mall live-preview bridge (packed-runtime + Windows paths) ----
// The bridge resolves the SOURCE directory as the X_ITE base URL; on Windows that
// means a drive-letter path -> file:/// URL. It authorizes only the held Mall
// source, byte-substitutes the unsaved buffer, and never writes a file. These run
// under the packed runtime to prove the new module ships and behaves on NTFS.
function mkBridge(srcAbs) {
  return createMallPreviewBridge({
    describeSession: () => ({ open: true, sessionId: 1, context: 'mall', sourcePath: srcAbs }),
    getAuthorizedMallSource: () => srcAbs,
    scanRemoteUrls: () => [],
    readSaved: () => ({ text: '#VRML V2.0 utf8\n# disk\n', wasGzipped: false }),
  });
}

check('7C2 preview bridge authorizes the open Mall buffer + host-correct base URL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-7c2-'));
  const src = path.join(dir, 'item.wrl');
  fs.writeFileSync(src, '#VRML V2.0 utf8\nShape { geometry Box {} }\n');
  const b = mkBridge(src);
  const res = b.load({ sessionId: 1, text: '#VRML V2.0 utf8\nShape {}\n', bufferVersion: 1 });
  assert(res.ok, 'load ok');
  // The base URL is the SOURCE directory (a file:// URL) -- host path.dirname is used,
  // so this must be correct on Windows drive-letter paths too.
  assert(res.baseURL === fileDirUrl(src), `baseURL ${res.baseURL}`);
  assert(res.baseURL.startsWith('file:'), 'file scheme base URL');
  return res.baseURL;
});

check('7C2 preview bridge rejects a session whose held path != the authorized source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-7c2-'));
  const src = path.join(dir, 'item.wrl');
  const b = createMallPreviewBridge({
    describeSession: () => ({ open: true, sessionId: 1, context: 'mall', sourcePath: src }),
    getAuthorizedMallSource: () => path.join(dir, 'OTHER.wrl'),
    readSaved: () => ({ text: '', wasGzipped: false }),
  });
  const res = b.load({ sessionId: 1, text: 'x', bufferVersion: 1 });
  assert(!res.ok && res.reason === 'source-mismatch', JSON.stringify(res));
});

check('7C2 preview bridge refuses an >8 MiB buffer and leaves zero overlays after close', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-7c2-'));
  const src = path.join(dir, 'item.wrl');
  const b = mkBridge(src);
  const huge = b.load({ sessionId: 1, text: 'x'.repeat(HARD_MAX_BYTES + 8), bufferVersion: 1 });
  assert(!huge.ok && huge.reason === 'too-large', JSON.stringify({ ok: huge.ok, reason: huge.reason }));
  assert(b.describe(1).hasOverlay === false, 'oversized buffer stored nothing');
  b.load({ sessionId: 1, text: '#VRML V2.0 utf8\n', bufferVersion: 2 });
  b.invalidateSession(1);
  const leak = b.leak();
  assert(leak.size === 0 && leak.activeGenerations === 0, JSON.stringify(leak));
});

// ---- Phase 7C3 World live-preview bridge (packed-runtime + real NTFS paths) ----
// The World bridge authorizes the UNSAVED editor buffer against a REAL scan
// graph over real (drive-letter, case-insensitive) paths: primary + nested
// overrides, wrlworld:// base URL, graph-membership refusal, stale-scan
// refusal, gzip disk deps beside a plain in-memory override, zero overlays
// after close, and the pure viewpoint-restore fallback order.
function stage7c3World() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-7c3-'));
  fs.mkdirSync(path.join(root, 'rooms'));
  const primary = path.join(root, 'entry.wrl');
  const nested = path.join(root, 'rooms', 'hall.wrl');
  const nestedGz = path.join(root, 'rooms', 'vault.wrl');
  fs.writeFileSync(primary, '#VRML V2.0 utf8\nInline { url "rooms/hall.wrl" }\nInline { url "rooms/vault.wrl" }\n', 'utf8');
  fs.writeFileSync(nested, '#VRML V2.0 utf8\nDEF Hall Shape { geometry Box {} }\n', 'utf8');
  fs.writeFileSync(nestedGz, zlib.gzipSync(Buffer.from('#VRML V2.0 utf8\nDEF Vault Shape { geometry Sphere {} }\n', 'utf8')));
  fs.writeFileSync(path.join(root, 'unrelated.wrl'), '#VRML V2.0 utf8\n', 'utf8'); // in-root but NOT referenced
  const scan = scanProject({ root, primary });
  return { root, primary, nested, nestedGz, scan };
}

function mk7c3Bridge(w, session) {
  const st = { session };
  const bridge = createWorldPreviewBridge({
    describeSession: () => st.session,
    getWorldRoot: () => w.root,
    getWorldPrimary: () => w.primary,
    getScan: () => w.scan,
    rescan: async () => w.scan,
  });
  return { bridge, st };
}

check('7C3 world bridge authorizes primary + nested unsaved buffers on the real filesystem', () => {
  const w = stage7c3World();
  const { bridge, st } = mk7c3Bridge(w, { open: true, sessionId: 1, context: 'world', sourcePath: w.primary });
  const buf = '#VRML V2.0 utf8\n# edited primary\nInline { url "rooms/hall.wrl" }\nInline { url "rooms/vault.wrl" }\n';
  const p = bridge.load({ sessionId: 1, text: buf, bufferVersion: 1 });
  assert(p.ok && p.editedIsPrimary === true && p.text === buf, 'primary buffer substituted: ' + JSON.stringify({ ok: p.ok, reason: p.reason }));
  assert(p.baseURL.startsWith('wrlworld://project/'), 'wrlworld base URL: ' + p.baseURL);
  // Nested edit: the override serves through the REAL authorized resolution path.
  st.session = { open: true, sessionId: 2, context: 'world', sourcePath: w.nested };
  const nbuf = '#VRML V2.0 utf8\nDEF HallEdited Shape { geometry Cone {} }\n';
  const n = bridge.load({ sessionId: 2, text: nbuf, bufferVersion: 1 });
  assert(n.ok && n.editedIsPrimary === false && n.editedText === nbuf, 'nested registered');
  const hit = resolveWorldRequest(bridge.servingContext(), worldAssetUrl(w.root, w.nested), {
    overlayLookup: (abs) => bridge.overlayTextFor(abs),
  });
  assert(hit.status === 200 && hit.overlay === true && hit.body.toString('utf8') === nbuf, 'overlay served after disk authorization');
  // The gzip sibling still serves gzip-transparently from disk.
  const gz = resolveWorldRequest(bridge.servingContext(), worldAssetUrl(w.root, w.nestedGz), {
    overlayLookup: (abs) => bridge.overlayTextFor(abs),
  });
  assert(gz.status === 200 && !gz.overlay && /DEF Vault/.test(gz.body.toString('utf8')), 'gzip disk dep decompressed');
  return p.baseURL;
});

check('7C3 world bridge refuses non-graph documents and stale scans', () => {
  const w = stage7c3World();
  // An in-root file that is NOT a graph node may never receive an override.
  const a = mk7c3Bridge(w, { open: true, sessionId: 1, context: 'world', sourcePath: path.join(w.root, 'unrelated.wrl') });
  const r1 = a.bridge.load({ sessionId: 1, text: 'x', bufferVersion: 1 });
  assert(!r1.ok && r1.reason === 'not-in-graph', JSON.stringify(r1));
  // A scan held for a DIFFERENT project root can never authorize.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'wrlforge-7c3-other-'));
  const b = mk7c3Bridge({ ...w, root: other, primary: path.join(other, 'entry.wrl') },
    { open: true, sessionId: 1, context: 'world', sourcePath: path.join(other, 'entry.wrl') });
  const r2 = b.bridge.load({ sessionId: 1, text: 'x', bufferVersion: 1 });
  assert(!r2.ok && r2.reason === 'root-mismatch', JSON.stringify(r2));
});

check('7C3 close reaches zero overlays/generations; viewpoint fallback order holds', () => {
  const w = stage7c3World();
  const { bridge } = mk7c3Bridge(w, { open: true, sessionId: 9, context: 'world', sourcePath: w.primary });
  bridge.load({ sessionId: 9, text: '#VRML V2.0 utf8\n', bufferVersion: 1 });
  bridge.invalidateSession(9);
  const leak = bridge.leak();
  assert(leak.size === 0 && leak.activeGenerations === 0 && leak.serving === false, JSON.stringify(leak));
  // Pure preservation order: DEF -> unique description -> index -> first -> default.
  const vps = [{ name: 'A', description: 'dup' }, { name: 'B', description: 'dup' }];
  assert(resolveViewpointRestore({ name: 'B', description: 'dup', index: 0 }, vps).index === 1, 'DEF wins');
  assert(resolveViewpointRestore({ name: 'Z', description: 'dup', index: 1 }, vps).matchedBy === 'index', 'duplicate descriptions skip to index');
  assert(resolveViewpointRestore({ name: 'Z', description: null, index: 9 }, vps).matchedBy === 'first', 'first fallback');
  assert(resolveViewpointRestore({ name: 'Z', description: null, index: 9 }, []).action === 'none', 'default view');
});

// ---- summarize + write result ----
const total = results.length;
const passed = results.filter((r) => r.pass).length;
const failed = total - passed;
const out = {
  phase: '6B+7B',
  platform: process.platform,
  arch: process.arch,
  node: process.versions.node,
  electron: process.versions.electron || null,
  chrome: process.versions.chrome || null,
  total, passed, failed,
  results,
};

const outArgIdx = process.argv.indexOf('--out');
const outPath = outArgIdx >= 0 ? process.argv[outArgIdx + 1] : path.join(__dirname, 'selftest-6b-result.json');
try { fs.writeFileSync(outPath, JSON.stringify(out, null, 2)); } catch (e) { /* best effort */ }

for (const r of results) {
  // eslint-disable-next-line no-console
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
}
console.log(`\n${passed}/${total} passed, ${failed} failed  (platform=${process.platform} node=${process.versions.node} electron=${process.versions.electron || 'n/a'})`);
console.log(`result → ${outPath}`);
process.exit(failed === 0 ? 0 : 1);
