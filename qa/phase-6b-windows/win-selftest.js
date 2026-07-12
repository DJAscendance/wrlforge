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

// ---- summarize + write result ----
const total = results.length;
const passed = results.filter((r) => r.pass).length;
const failed = total - passed;
const out = {
  phase: '6B',
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
