'use strict';
// Deterministic app-icon generator for WRL Forge (Phase 7C5.1).
//
//   npm run build:icons
//
// Rasterizes the four OWNER-APPROVED source SVGs in assets/ into the platform
// icon assets the app and electron-builder consume, writing everything under
// assets/generated/icons/ (kept strictly separate from the source artwork).
//
// Product mapping (see docs/ICONS.md):
//   wrl-forge-cyan.svg               -> PRIMARY packaged/executable/window icon
//   wrl-forge-cyan-transparent.svg   -> in-app / About branding on suitable bg
//   wrl-forge-yellow.svg             -> approved ALTERNATE packaged-icon source
//   wrl-forge-yellow-transparent.svg -> approved ALTERNATE in-app asset
//
// ALL FOUR variants are also emitted as multi-resolution .ico files under
// windows/ and shipped inside the installed app, so a user can repoint their
// own shortcut to whichever they prefer via Windows' native "Change Icon"
// dialog. The DEFAULT executable identity stays cyan opaque -- there is no
// second product edition or alternate executable. A build may start from a
// different variant via the WRL_FORGE_ICON env var (cyan | cyan-transparent |
// yellow | yellow-transparent); see scripts/build-win.js and docs/ICONS.md.
//
// Determinism: rendering runs with system fonts DISABLED so the tiny "FORGE"
// caption (sub-pixel at icon sizes, and font-dependent) is not rasterized. That
// makes output identical across machines regardless of installed fonts. Running
// this twice on one platform is byte-identical; cross-platform identity is
// verified/handled by the icon-generation tests and documented in docs/ICONS.md.
//
// The multi-resolution .ico is assembled here in pure Node (PNG-embedding ICO
// container) so no ICO/image-encoding dependency is added -- @resvg/resvg-js is
// the only new (dev-only) dependency, used purely for SVG -> PNG rasterization.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Resvg } = require('@resvg/resvg-js');

const ASSETS = path.join(__dirname, '..', 'assets');
const OUT = path.join(ASSETS, 'generated', 'icons');

// Source artwork (never written by this script). `variant` is the WRL_FORGE_ICON
// selector token; `key` indexes the SOURCES map.
const VARIANTS = [
  { variant: 'cyan', key: 'cyan', file: 'wrl-forge-cyan.svg', opaque: true, role: 'primary' },
  { variant: 'cyan-transparent', key: 'cyanTransparent', file: 'wrl-forge-cyan-transparent.svg', opaque: false, role: 'in-app' },
  { variant: 'yellow', key: 'yellow', file: 'wrl-forge-yellow.svg', opaque: true, role: 'alternate' },
  { variant: 'yellow-transparent', key: 'yellowTransparent', file: 'wrl-forge-yellow-transparent.svg', opaque: false, role: 'alternate-in-app' },
];
const SOURCES = Object.fromEntries(VARIANTS.map((v) => [v.key, v.file]));
// The default executable identity. Overridable at build time only.
const PRIMARY_VARIANT = 'cyan';
// icon filename (under windows/) for a given variant token.
const icoName = (variant) => `wrl-forge-${variant}.ico`;

// Windows shell / Electron packaging icon sizes.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// Linux/freedesktop hicolor + runtime PNG sizes.
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
// Single-file runtime window icon + in-app logo size.
const RUNTIME_ICON = 256;
const ABOUT_LOGO = 256;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Rasterize an SVG source buffer to a PNG buffer at a square pixel size, with
// system fonts disabled for cross-machine determinism.
function rasterize(svgBuf, size) {
  const r = new Resvg(svgBuf, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  });
  return r.render().asPng();
}

// Read a PNG's pixel dimensions from its IHDR (width @16, height @20).
function pngSize(buf) {
  if (buf.slice(1, 4).toString('latin1') !== 'PNG') throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Assemble a multi-image .ico (PNG-embedding container) from {size, png} pairs.
// Modern Windows shells and Electron read PNG-compressed ICO entries directly.
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: 1 = icon
  header.writeUInt16LE(count, 4);  // image count

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0);  // width (0 => 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1);  // height (0 => 256)
    dir.writeUInt8(0, b + 2);                            // palette colors
    dir.writeUInt8(0, b + 3);                            // reserved
    dir.writeUInt16LE(1, b + 4);                         // color planes
    dir.writeUInt16LE(32, b + 6);                        // bits per pixel
    dir.writeUInt32LE(e.png.length, b + 8);              // bytes in resource
    dir.writeUInt32LE(offset, b + 12);                   // offset from file start
    offset += e.png.length;
    blobs.push(e.png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

function writeFile(rel, buf) {
  const full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return { file: path.posix.join('assets/generated/icons', rel.split(path.sep).join('/')), bytes: buf.length, sha256: sha256(buf) };
}

function generate() {
  const src = {};
  const sourceHashes = {};
  for (const [key, name] of Object.entries(SOURCES)) {
    const p = path.join(ASSETS, name);
    src[key] = fs.readFileSync(p);
    sourceHashes[name] = sha256(src[key]);
  }

  // Clean the generated tree so removed sizes never linger (deterministic set).
  fs.rmSync(OUT, { recursive: true, force: true });

  const outputs = [];

  // --- All four variants as choosable multi-resolution ICOs ---
  // These ship inside the installed app; cyan is the default exe identity, the
  // others let a user repoint their shortcut via Windows "Change Icon".
  for (const v of VARIANTS) {
    const entries = ICO_SIZES.map((size) => ({ size, png: rasterize(src[v.key], size) }));
    outputs.push(writeFile(path.join('windows', icoName(v.variant)), buildIco(entries)));
  }

  // --- PRIMARY (cyan opaque): Linux PNG set + runtime window icon ---
  for (const size of PNG_SIZES) {
    outputs.push(writeFile(path.join('linux', `${size}x${size}.png`), rasterize(src.cyan, size)));
  }
  outputs.push(writeFile(path.join('runtime', 'icon.png'), rasterize(src.cyan, RUNTIME_ICON)));
  // In-app / About branding uses the transparent cyan artwork.
  outputs.push(writeFile(path.join('runtime', 'about-logo.png'), rasterize(src.cyanTransparent, ABOUT_LOGO)));

  // Manifest: provenance (source -> outputs) + committed source hashes. Ordered
  // deterministically so the manifest itself is reproducible.
  const manifest = {
    generator: 'scripts/build-icons.js',
    rasterizer: `@resvg/resvg-js@${require('@resvg/resvg-js/package.json').version}`,
    note: 'System fonts disabled for cross-machine determinism; the SVG "FORGE" caption is intentionally not rasterized.',
    primaryVariant: PRIMARY_VARIANT,
    primaryIcon: path.posix.join('assets/generated/icons/windows', icoName(PRIMARY_VARIANT)),
    choosableVariants: VARIANTS.map((v) => v.variant),
    icoSizes: ICO_SIZES,
    pngSizes: PNG_SIZES,
    sourceHashes,
    outputs: outputs.sort((a, b) => a.file.localeCompare(b.file)),
  };
  fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

  // Prove the source artwork was not touched.
  for (const name of Object.values(SOURCES)) {
    const after = sha256(fs.readFileSync(path.join(ASSETS, name)));
    if (after !== sourceHashes[name]) {
      throw new Error(`source SVG mutated during generation: ${name}`);
    }
  }
  return manifest;
}

// Resolve the WRL_FORGE_ICON selector to a repo-relative primary .ico path.
// Unknown/empty -> the cyan default. Used by scripts/build-win.js.
function resolvePrimaryIcon(selector) {
  const token = String(selector || '').trim().toLowerCase();
  const match = VARIANTS.find((v) => v.variant === token);
  const variant = match ? match.variant : PRIMARY_VARIANT;
  return {
    variant,
    isDefault: variant === PRIMARY_VARIANT,
    relPath: path.posix.join('assets/generated/icons/windows', icoName(variant)),
  };
}

if (require.main === module) {
  const m = generate();
  const n = m.outputs.length;
  process.stdout.write(`build:icons -> ${n} generated files under assets/generated/icons/ (primary: ${m.primaryVariant})\n`);
  for (const o of m.outputs) process.stdout.write(`  ${o.file}  ${o.bytes}B  ${o.sha256.slice(0, 12)}\n`);
}

module.exports = {
  generate, buildIco, pngSize, rasterize, resolvePrimaryIcon,
  ICO_SIZES, PNG_SIZES, SOURCES, VARIANTS, PRIMARY_VARIANT, icoName, OUT, ASSETS,
};
