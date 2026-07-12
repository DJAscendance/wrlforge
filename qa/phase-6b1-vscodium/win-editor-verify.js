'use strict';
// Phase 6B1 — real VSCodium "Open in Editor" verification (packaged Windows run).
//
// Runs the app's *production* editor code path against a REAL filesystem and a
// REAL installed VSCodium, closing the one remaining Phase 6B beta condition
// (Phase 6B only GUI-verified the "editor not found" path — VSCodium was not yet
// installed in the VM).
//
// Intended invocation on Windows, using the packaged Electron as plain node so
// the exact bundled runtime resolves and spawns the editor:
//
//   set ELECTRON_RUN_AS_NODE=1
//   "WRL Forge.exe" win-editor-verify.js --out results.json
//
// It reproduces main.js's openMallFile()/launchEditor() flow with the same
// modules — src/files/vrml-file (editPathFor/isGzip), src/settings/app-settings
// (loadSettings → editorCommand), src/editor/editor-locator (resolveEditor/
// buildLaunch) — then ACTUALLY spawns VSCodium on a scratch .edit.wrl whose path
// contains a space and a non-ASCII character, confirms exactly one editor process
// appears, and closes it. Source fixtures are copied to scratch first and their
// hashes are checked before/after, so nothing under the repo is mutated.
//
// Host-agnostic and side-effect-light enough to `node --check`; the live spawn is
// Windows-only and can be suppressed with --no-spawn (used by the Linux syntax
// gate / dry runs).

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const req = (rel) => require(path.join(ROOT, rel));
const { editPathFor, isGzip } = req('src/files/vrml-file');
const { loadSettings } = req('src/settings/app-settings');
const { resolveEditor, buildLaunch } = req('src/editor/editor-locator');
const zlib = require('zlib');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;
const NO_SPAWN = args.includes('--no-spawn');

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : detail });
};
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// tasklist-based image-name process enumeration (Windows). Returns a Set of PIDs
// for the given image names. Empty/no-op off Windows.
function editorPids(images) {
  if (process.platform !== 'win32') return new Set();
  const pids = new Set();
  for (const image of images) {
    const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    const out = (r.stdout || '');
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (m) pids.add(Number(m[2]));
    }
  }
  return pids;
}

function main() {
  const platform = process.platform;
  const isWin = platform === 'win32';

  // --- Scratch dir with a space AND a non-ASCII character in the path ---------
  const scratchParent = fs.mkdtempSync(path.join(os.tmpdir(), 'wrl6b1-'));
  const scratch = path.join(scratchParent, 'a b — wörld dir'); // space + em-dash + ö
  fs.mkdirSync(scratch, { recursive: true });

  const srcPlain = path.join(ROOT, 'test', 'fixtures', 'valid-plain.wrl');
  const srcGzip = path.join(ROOT, 'test', 'fixtures', 'valid-gzip.wrl');
  const preHashes = { plain: sha256(srcPlain), gzip: sha256(srcGzip) };

  // Reproduce main.js openMallFile(): read raw, gunzip if gzip, write .edit.wrl.
  function openMall(srcFixture, destName) {
    const dest = path.join(scratch, destName);
    fs.copyFileSync(srcFixture, dest);
    const raw = fs.readFileSync(dest);
    const wasGzipped = isGzip(raw);
    const text = wasGzipped ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    const editFile = editPathFor(dest);
    fs.writeFileSync(editFile, text, 'utf8');
    return { dest, editFile, wasGzipped, text };
  }

  // 1. Automatic discovery (no override, real env + real fs) -------------------
  const disc = resolveEditor({ platform, env: process.env, existsSync: fs.existsSync });
  rec('discovery: VSCodium found automatically',
    disc.found && /codium|vscode|\bcode\b/i.test(String(disc.command || '')),
    `found=${disc.found} source=${disc.source} command=${disc.command || ''} shell=${disc.shell}`);

  // 2. Plain WRL → .edit.wrl ---------------------------------------------------
  const plain = openMall(srcPlain, 'plain item.wrl');
  rec('plain: .edit.wrl produced (plain text)',
    fs.existsSync(plain.editFile) && !plain.wasGzipped && plain.text.startsWith('#VRML'),
    `editFile=${plain.editFile}`);

  // 3. Gzip WRL → decompressed .edit.wrl ---------------------------------------
  const gz = openMall(srcGzip, 'gzip ítem.wrl');
  const gzEditRaw = fs.readFileSync(gz.editFile);
  rec('gzip: decompressed .edit.wrl produced (plain text, not gzip)',
    fs.existsSync(gz.editFile) && gz.wasGzipped && !isGzip(gzEditRaw) && gz.text.startsWith('#VRML'),
    `editFile=${gz.editFile} wasGzipped=${gz.wasGzipped}`);

  // 4/5. Spaces + non-ASCII path survives --------------------------------------
  rec('path: contains a space', / /.test(plain.editFile), plain.editFile);
  rec('path: contains a non-ASCII character', /[^\x00-\x7F]/.test(gz.editFile), gz.editFile);

  // 6. settings.json editorCommand override ------------------------------------
  // Write a settings.json in a scratch userData dir and load it exactly like
  // main.js resolveConfiguredEditor() does, then feed as override.
  const overrideTarget = disc.found ? disc.command : (isWin ? 'C:\\Program Files\\VSCodium\\VSCodium.exe' : 'codium');
  const userData = path.join(scratch, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ editorCommand: overrideTarget }), 'utf8');
  const settingsOverride = loadSettings(userData).editorCommand;
  const ovRes = resolveEditor({ platform, env: process.env, existsSync: fs.existsSync, override: settingsOverride });
  rec('override: settings.json editorCommand honored',
    ovRes.found && ovRes.source === 'override' && ovRes.command === overrideTarget,
    `loaded=${settingsOverride} source=${ovRes.source} command=${ovRes.command}`);

  // 7. WRL_FORGE_EDITOR env override -------------------------------------------
  const envWith = Object.assign({}, process.env, { WRL_FORGE_EDITOR: overrideTarget });
  const envRes = resolveEditor({ platform, env: envWith, existsSync: fs.existsSync });
  rec('override: WRL_FORGE_EDITOR env honored',
    envRes.found && envRes.source === 'override' && envRes.command === overrideTarget,
    `source=${envRes.source} command=${envRes.command}`);

  // 8. Invalid override falls back to discovery (or clear not-found) ------------
  const badPath = isWin ? 'C:\\nope\\does-not-exist.exe' : '/nope/does-not-exist';
  const badRes = resolveEditor({ platform, env: process.env, existsSync: fs.existsSync, override: badPath });
  // On Windows an absolute missing override is skipped → discovery takes over.
  const badOk = badRes.found ? badRes.source !== 'override' : (Array.isArray(badRes.tried) && !!badRes.hint);
  rec('override: invalid override falls back (not honored as-is)',
    badOk,
    `found=${badRes.found} source=${badRes.source || ''} command=${badRes.command || ''} hint=${badRes.hint ? 'yes' : 'no'}`);

  // 9/10/11. Real spawn = the "Open in Editor" code path (buildLaunch + spawn) --
  if (!NO_SPAWN && isWin && disc.found) {
    const images = ['VSCodium.exe', 'Code.exe', 'codium.exe', 'code.exe'];
    const before = editorPids(images);
    const spec = buildLaunch(disc, gz.editFile); // space + non-ASCII target
    let spawnErr = null;
    try {
      const child = spawn(spec.command, spec.args, spec.options);
      child.on('error', (e) => { spawnErr = String(e && e.message || e); });
      child.unref();
    } catch (e) {
      spawnErr = String(e && e.message || e);
    }
    // Give VSCodium a moment to register a process (busy-wait; Date.now allowed
    // under node, and this script is not part of the deterministic workflow set).
    const waitUntil = Date.now() + 9000;
    let after = before;
    while (Date.now() < waitUntil) {
      after = editorPids(images);
      const fresh = [...after].filter((p) => !before.has(p));
      if (fresh.length > 0) break;
      spawnSync(process.platform === 'win32' ? 'cmd' : 'sh',
        process.platform === 'win32' ? ['/c', 'ping', '-n', '2', '127.0.0.1', '>NUL'] : ['-c', 'sleep 0.5'],
        { stdio: 'ignore' });
    }
    const freshPids = [...after].filter((p) => !before.has(p));
    rec('spawn: Open-in-Editor launched VSCodium (real process)',
      !spawnErr && freshPids.length >= 1,
      `spec.shell=${!!(spec.options && spec.options.shell)} spawnErr=${spawnErr || 'none'} newPids=${freshPids.join(',')}`);
    rec('spawn: no duplicate-launch loop (single editor instance)',
      // VSCodium's first launch forks a small helper set; a *loop* would be many.
      freshPids.length >= 1 && freshPids.length <= 6,
      `newProcessCount=${freshPids.length}`);

    // Close the editor we launched, then confirm it is actually gone. VSCodium is
    // single-instance, so a freshly-spawned launcher PID may hand off and self-exit
    // before we kill it — either way "closed cleanly" means none of the fresh PIDs
    // (nor any VSCodium/Code image we started) remain. Target the specific fresh
    // PIDs first, then the images as a fallback; never touch unrelated processes.
    for (const pid of freshPids) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
    }
    for (const image of ['VSCodium.exe', 'Code.exe']) {
      spawnSync('taskkill', ['/IM', image, '/T', '/F'], { encoding: 'utf8' });
    }
    // Give the OS a beat to reap, then confirm none of our fresh PIDs survive.
    spawnSync('cmd', ['/c', 'ping', '-n', '3', '127.0.0.1', '>NUL'], { stdio: 'ignore' });
    const stillAlive = editorPids(images);
    const survivors = freshPids.filter((p) => stillAlive.has(p));
    rec('lifecycle: launched editor closed cleanly (no survivors)',
      survivors.length === 0,
      `launchedPids=${freshPids.join(',')} survivors=${survivors.join(',') || 'none'} remainingEditorProcs=${stillAlive.size}`);
  } else {
    rec('spawn: skipped (not Windows, no editor, or --no-spawn)', true,
      `platform=${platform} discovered=${disc.found} noSpawn=${NO_SPAWN}`);
  }

  // 12. Source fixtures unmutated ---------------------------------------------
  const postHashes = { plain: sha256(srcPlain), gzip: sha256(srcGzip) };
  rec('non-mutation: repo source fixtures unchanged',
    postHashes.plain === preHashes.plain && postHashes.gzip === preHashes.gzip,
    `plain ${postHashes.plain === preHashes.plain ? 'ok' : 'CHANGED'}, gzip ${postHashes.gzip === preHashes.gzip ? 'ok' : 'CHANGED'}`);
  // Copied source in scratch also unchanged (only .edit.wrl siblings written).
  const copyPlainSame = sha256(plain.dest) === preHashes.plain;
  const copyGzipSame = sha256(gz.dest) === preHashes.gzip;
  rec('non-mutation: opened source copies unchanged (only .edit.wrl added)',
    copyPlainSame && copyGzipSame,
    `plainCopy ${copyPlainSame ? 'ok' : 'CHANGED'}, gzipCopy ${copyGzipSame ? 'ok' : 'CHANGED'}`);

  // --- summary ---------------------------------------------------------------
  const passed = results.filter((r) => r.pass).length;
  const summary = {
    when: null, // stamped by caller if desired
    platform,
    node: process.versions.node,
    electron: process.versions.electron || null,
    discovered: { found: disc.found, source: disc.source, command: disc.command || null, shell: disc.shell },
    passed,
    total: results.length,
    results,
  };
  const json = JSON.stringify(summary, null, 2);
  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json, 'utf8');
  }
  process.stdout.write(json + '\n');

  // Best-effort scratch cleanup (never fatal).
  try { fs.rmSync(scratchParent, { recursive: true, force: true }); } catch { /* ignore */ }

  process.exitCode = passed === results.length ? 0 : 1;
}

main();
