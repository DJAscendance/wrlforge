'use strict';

function backupPath(filePath, now = () => new Date()) {
  const ts = now().toISOString().replace(/[:.]/g, '-');
  return `${filePath}.bak-${ts}`;
}

module.exports = { backupPath };
