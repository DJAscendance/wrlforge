'use strict';
const path = require('path');

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

function isGzip(buf) {
  return buf.length >= 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1];
}

// Plain-text working copy lives next to the mall .wrl as "<name>.edit.wrl",
// so VSCodium's existing X3D/VRML extensions (syntax highlighting + live
// preview) can open it directly -- they can't render/edit inside a gzip file.
function editPathFor(mallPath) {
  const dir = path.dirname(mallPath);
  const base = path.basename(mallPath, path.extname(mallPath));
  return path.join(dir, `${base}.edit.wrl`);
}

module.exports = { GZIP_MAGIC, isGzip, editPathFor };
