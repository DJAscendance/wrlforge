'use strict';
// Phase 7B1 diagnostic: does the external-editor launch path resolve VSCodium on
// this Windows VM, and is WRL_FORGE_NO_EDITOR poisoning the environment? Run under
// the packed Electron-as-node (see diag-editor.bat). Prints to stdout.
const path = require('path');
const ROOT = '\\\\host.lan\\Data\\Projects\\cybertown\\wrlforge';
const { resolveEditor, buildLaunch } = require(path.join(ROOT, 'src', 'editor', 'editor-locator.js'));

console.log('WRL_FORGE_NO_EDITOR=[' + (process.env.WRL_FORGE_NO_EDITOR || '') + ']');
console.log('WRL_FORGE_EDITOR=[' + (process.env.WRL_FORGE_EDITOR || '') + ']');
const r = resolveEditor({});
console.log('resolveEditor=' + JSON.stringify(r));
if (r.found) {
  console.log('buildLaunch=' + JSON.stringify(buildLaunch(r, 'C:\\Users\\ryan\\x.edit.wrl')));
}
