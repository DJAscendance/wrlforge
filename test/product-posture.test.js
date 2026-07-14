'use strict';
// Product-posture guard (Phase 7 pre-work). WRL Forge will NOT implement direct
// uploads to Cybertown, must not advertise absent features, and treats the
// external editor (VSCodium) as OPTIONAL. This test locks those decisions into the
// shipped user-facing surface so a future edit can't silently reintroduce
// prototype / "not functioning" / direct-upload / editor-required wording.
//
// Scope: the strings a user actually sees — renderer HTML/JS (including the native
// editor surface renderer/editor.html + renderer/editor.js), the main-process
// dialog/label strings, and the bundle label constant. It does NOT scan docs,
// tests, or QA harnesses (those legitimately record history and rationale).
//
// It deliberately does NOT ban truthful runtime states (missing file, parse error,
// blocked remote URL, case mismatch, unsaved changes, editor-not-found, conservative
// bounds, unsupported syntax) — only marketing-style "unavailable feature" copy.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The user-visible surface of the shipped app.
const UI_FILES = [
  'renderer/index.html',
  'renderer/renderer.js',
  'renderer/preview.js',
  'renderer/world.html',
  'renderer/world.js',
  'renderer/world-preview.js',
  'renderer/world-packaging.js',
  'renderer/editor.html',
  'renderer/editor.js',
  'main.js',
  'preload.js',
];

// Marketing-style wording that must never appear in the user-facing surface.
// Each entry is a human label + a RegExp. Kept narrow enough to avoid tripping on
// legitimate operational text (e.g. "Not an upload validator" is allowed).
const BANNED = [
  ['private test build', /private test build/i],
  ['test build (label)', /\btest build\b/i],
  ['prototype', /(?<![.\w])prototype\b/i],
  ['experimental feature', /experimental feature/i],
  ['not functioning', /not functioning/i],
  ['coming soon', /coming soon/i],
  ['not implemented', /not implemented/i],
  ['future feature', /future feature/i],
  ['not confirmed for direct upload', /not confirmed for direct/i],
  ['direct upload unavailable', /direct upload unavailable/i],
  ['requires VSCodium', /requires vscodium/i],
  ['technology demonstration', /technology demonstration/i],
  ['old bundle label', /Review Bundle\s*[—-]\s*Not Confirmed/i],
  // Bare user-facing "Review Bundle" label. The space distinguishes it from the
  // intentionally-stable internal IPC channel `world:buildReviewBundle` (camelCase,
  // no space), which is not user-facing and must NOT be renamed.
  ['user-facing Review Bundle label', /\bReview Bundle\b/],
  ['old editor button', /Open in VSCodium/],
  // The native editor SHIPS -- it must never be described to users as planned/upcoming.
  ['native editor planned', /native editor\b[^.]{0,40}\b(planned|coming soon|upcoming|not yet|will be)/i],
  ['planned native editor', /(planned|upcoming|future|forthcoming)\b[^.]{0,20}\bnative editor/i],
  // NOTE: The Mall unsaved-buffer X_ITE preview SHIPS as of Phase 7C2, so wording
  // like "renders your unsaved edits" is now accurate and no longer banned. (World
  // unsaved preview is still Phase 7C3; the World workspace must not claim it -- but
  // world.html contains no such claim, and this guard is about ABSENT features.)
];

test('no prototype / unavailable-feature wording in the user-facing surface', () => {
  const hits = [];
  for (const rel of UI_FILES) {
    const text = read(rel);
    for (const [label, re] of BANNED) {
      if (re.test(text)) hits.push(`${rel}: banned wording "${label}"`);
    }
  }
  assert.deepEqual(hits, [], 'user-facing copy must not advertise absent features:\n' + hits.join('\n'));
});

test('no direct-upload controls or claims in the user-facing surface', () => {
  // We must not present a "upload to Cybertown" / "submit to server" ACTION as if
  // WRL Forge performed it. (Neutral phrases like "upload through the Cybertown
  // website" and "manual upload" are allowed — they describe the external workflow.)
  const forbidden = [
    /upload (directly )?to cybertown/i,
    /direct(ly)? upload/i,
    /submit to (the )?(cybertown )?server/i,
  ];
  const hits = [];
  for (const rel of UI_FILES) {
    const text = read(rel);
    for (const re of forbidden) {
      if (re.test(text)) hits.push(`${rel}: ${re}`);
    }
  }
  assert.deepEqual(hits, [], 'no direct-upload action/claim may appear:\n' + hits.join('\n'));
});

test('the review bundle is named "WRL Forge World Project Bundle"', () => {
  const { BUNDLE_LABEL } = require(path.join(ROOT, 'src/world-project/package-plan.js'));
  assert.equal(BUNDLE_LABEL, 'WRL Forge World Project Bundle');

  // The user-facing build button uses the new name (not the old "Review Bundle").
  assert.match(read('renderer/world.html'), /Build World Project Bundle/);
  assert.doesNotMatch(read('renderer/world.html'), /Build Review Bundle/);
});

test('the external editor is presented as optional', () => {
  const index = read('renderer/index.html');
  // The launch buttons use editor-neutral wording.
  assert.match(index, /Open in External Editor/);
  assert.match(read('renderer/world.html'), /Open Primary WRL in External Editor/);

  // The Mall subtitle must not claim editing "happens in" (i.e. requires) VSCodium.
  assert.doesNotMatch(index, /editing happens in VSCodium/i);
  assert.match(index, /optional/i);
});

test('the Windows build scripts are cross-platform (no POSIX inline-env syntax)', () => {
  // Phase 7C5: `CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder ...` is bash-only
  // and cmd.exe (npm's shell on Windows) fails with "not recognized", so a native
  // Windows build broke. The scripts must route through node scripts/build-win.js,
  // which sets the signing guard in-process on every platform.
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const name of ['build:win', 'build:win:portable']) {
    assert.doesNotMatch(scripts[name], /CSC_IDENTITY_AUTO_DISCOVERY=/, `${name} must not use POSIX inline-env syntax`);
    assert.match(scripts[name], /node scripts\/build-win\.js/, `${name} must use the cross-platform wrapper`);
  }
  // The wrapper still enforces the unsigned-determinism guard.
  const wrapper = read('scripts/build-win.js');
  assert.match(wrapper, /CSC_IDENTITY_AUTO_DISCOVERY/, 'wrapper must set the signing guard');
  assert.match(wrapper, /--publish['"\s,]+never/, 'wrapper must never publish');
});

test('opening a file does not passively surface an "editor not found" message', () => {
  // Part 3: the not-found message appears only on the explicit external-editor
  // action, never merely from opening a file. applyState() must not call
  // showEditorStatus with the open result.
  const rjs = read('renderer/renderer.js');
  const applyState = rjs.slice(rjs.indexOf('function applyState'), rjs.indexOf('function startPolling'));
  assert.doesNotMatch(applyState, /showEditorStatus\(data\.editorStatus\)/);
});

test('the app icon identity is cyan WRL Forge branding, generated from an approved SVG', () => {
  // Phase 7C5.1: the four owner-approved SVGs are the ONLY source artwork, and
  // cyan opaque is the single executable identity. Yellow is an approved alternate
  // but must never silently become the primary icon, and no build config may point
  // back at the retired placeholder (assets/icon.ico) or a hand-authored binary.
  const build = JSON.parse(read('package.json')).build;
  assert.equal(build.win.icon, 'assets/generated/icons/windows/wrl-forge-cyan.ico');
  assert.doesNotMatch(build.win.icon, /yellow/i, 'yellow must not be the executable identity');
  assert.doesNotMatch(build.win.icon, /assets\/icon\.ico/, 'the retired placeholder icon must not be referenced');
  for (const name of ['wrl-forge-cyan.svg', 'wrl-forge-cyan-transparent.svg', 'wrl-forge-yellow.svg', 'wrl-forge-yellow-transparent.svg']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'assets', name)), `approved source artwork ${name} must be present`);
  }
});

test('no release binaries or installers are committed anywhere in the repo', () => {
  // QA-evidence guard: .exe / installer / unpacked-app artifacts must never be
  // committed (release/ is git-ignored; evidence dirs hold only text + screenshots).
  const tracked = require('child_process')
    .execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const banned = tracked.filter((f) => /\.(exe|msi|dll|node|appx|dmg|blockmap)$/i.test(f)
    || /-setup\.exe$|-portable\.exe$/i.test(f)
    || /(^|\/)win-unpacked\//i.test(f)
    || /(^|\/)release\//i.test(f));
  assert.deepEqual(banned, [], `release binaries must not be committed: ${banned.join(', ')}`);
});
