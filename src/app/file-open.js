'use strict';

const path = require('path');
const { fileURLToPath } = require('url');

const VRML_EXTENSIONS = new Set(['.wrl', '.wrz']);

function argumentPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('-')) return null;
  if (value.startsWith('file://')) {
    try {
      return fileURLToPath(value);
    } catch {
      return null;
    }
  }
  return value;
}

// Desktop shells append the selected file to argv. In development, Electron
// also includes the app directory (usually ".") in argv, so accept only a real
// .wrl/.wrz file and ignore every other argument.
function findVrmlFileArgument(argv, deps = {}) {
  const existsSync = deps.existsSync || require('fs').existsSync;
  const statSync = deps.statSync || require('fs').statSync;
  const resolve = deps.resolve || path.resolve;

  for (const value of Array.isArray(argv) ? argv : []) {
    const candidate = argumentPath(value);
    if (!candidate || !VRML_EXTENSIONS.has(path.extname(candidate).toLowerCase())) continue;
    const absolute = resolve(candidate);
    try {
      if (existsSync(absolute) && statSync(absolute).isFile()) return absolute;
    } catch {
      // A stale recent-file entry or inaccessible path is not an app failure.
    }
  }
  return null;
}

module.exports = { findVrmlFileArgument };
