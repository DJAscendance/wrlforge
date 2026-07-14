'use strict';
// Documentation link checker for the public-beta docs. For every tracked
// Markdown file in the doc set, resolve each relative Markdown link and image
// reference against the filesystem (repo-root anchored where the target begins
// with the repo root, otherwise relative to the file's directory). Reports any
// broken relative link/image. External (http/https/mailto) and pure in-page
// anchors (#...) are skipped. Prints a summary and exits non-zero on any break.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FILES = [
  'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'COPYRIGHT.md', 'LICENSE',
  'SECURITY.md', 'SUPPORT.md', 'THIRD_PARTY_NOTICES.md',
  'docs/INSTALLATION.md', 'docs/TROUBLESHOOTING.md', 'docs/RELEASES.md',
  'docs/SCREENSHOTS_AND_USAGE.md',
].filter((f) => fs.existsSync(path.join(ROOT, f)));

const linkRe = /(!?)\[[^\]]*\]\(([^)]+)\)/g;
let broken = [];
let checked = 0;

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  const dir = path.dirname(abs);
  const text = fs.readFileSync(abs, 'utf8');
  let m;
  while ((m = linkRe.exec(text)) !== null) {
    let target = m[2].trim();
    // strip title and anchor
    target = target.split(/\s+/)[0].replace(/#.*$/, '');
    if (!target) continue;
    if (/^(https?:|mailto:|tel:)/i.test(target)) continue;
    checked++;
    const resolved = path.resolve(dir, decodeURIComponent(target));
    if (!fs.existsSync(resolved)) {
      broken.push(`${rel}: ${m[0].slice(0, 60)}  ->  ${target}`);
    }
  }
}

console.log(`Checked ${checked} relative link(s)/image(s) across ${FILES.length} doc file(s).`);
if (broken.length) {
  console.error(`\nBROKEN (${broken.length}):`);
  for (const b of broken) console.error('  - ' + b);
  process.exit(1);
}
console.log('All relative links and images resolve. OK.');
