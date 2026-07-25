'use strict';
// Lightweight packaging-config validation for CI (no electron download).
// Asserts package.json metadata + the electron-builder `build` block declare
// exactly the public-beta targets and canonical artifact names this release
// lane depends on. Fails fast with a clear message if a required target or name
// drifts, so a mis-named or missing artifact is caught before a release build.

const pkg = require('../../package.json');

const problems = [];
const req = (cond, msg) => { if (!cond) problems.push(msg); };

// --- top-level metadata ---
req(pkg.version === '1.3.0-beta.3', `version must be 1.3.0-beta.3 (got ${pkg.version})`);
req(pkg.author === 'Ryan Bundy (BassMekanik2000)', `author must be "Ryan Bundy (BassMekanik2000)" (got ${JSON.stringify(pkg.author)})`);
req(pkg.license === 'MIT', `license must be MIT (got ${JSON.stringify(pkg.license)})`);
req(pkg.homepage === 'https://wrlforge.com', `homepage must be https://wrlforge.com (got ${JSON.stringify(pkg.homepage)})`);

const b = pkg.build || {};
req(b.copyright === 'Copyright © 2026 Ryan Bundy (BassMekanik2000)', `build.copyright must be the Ryan Bundy (BassMekanik2000) copyright line (got ${JSON.stringify(b.copyright)})`);

// --- Linux targets ---
const linuxTargets = (b.linux && b.linux.target || []).map((t) => t.target);
req(linuxTargets.includes('AppImage'), 'linux target AppImage missing');
req(linuxTargets.includes('tar.gz'), 'linux target tar.gz missing');
req(b.appImage && /WRL-Forge-\$\{version\}-linux-x64\.AppImage/.test(b.appImage.artifactName || ''), 'appImage.artifactName not canonical');

// --- Windows targets ---
// The Windows ZIP is assembled from win-unpacked in the release workflow (the
// electron-builder `zip` target collided with the `msi` output name), so only
// nsis/msi/portable are declared here.
const winTargets = (b.win && b.win.target || []).map((t) => t.target);
for (const t of ['nsis', 'msi', 'portable']) {
  req(winTargets.includes(t), `windows target ${t} missing`);
}
req(/WRL-Forge-Setup-\$\{version\}-x64\.exe/.test((b.nsis || {}).artifactName || ''), 'nsis.artifactName not canonical');
req(/WRL-Forge-\$\{version\}-x64\.msi/.test((b.msi || {}).artifactName || ''), 'msi.artifactName not canonical');
req(/WRL-Forge-Portable-\$\{version\}-x64\.exe/.test((b.portable || {}).artifactName || ''), 'portable.artifactName not canonical');

// --- global artifactName (covers AppImage/tar.gz/zip via ${os}) ---
req(/WRL-Forge-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}/.test(b.artifactName || ''), 'global build.artifactName not canonical');

// --- required scripts ---
for (const s of ['dist:linux', 'dist:windows', 'release:checksums', 'build:icons', 'build:editor', 'check']) {
  req(pkg.scripts && pkg.scripts[s], `npm script "${s}" missing`);
}

if (problems.length) {
  console.error('Packaging config validation FAILED:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('Packaging config OK: version, metadata, Linux + Windows targets, canonical artifact names, and release scripts all present.');
