'use strict';
const path = require('path');

const WINDOW_STATE_FILENAME = 'window-state.json';
const DEFAULT_WINDOW_STATE = { width: 900, height: 700 };

function windowStatePath(userDataPath) {
  return path.join(userDataPath, WINDOW_STATE_FILENAME);
}

// This app was previously named "vrmlpad" -- Electron derives userData from
// the package.json "name" field, so the rename to "wrl-forge" moved that
// directory. Fall back to the old sibling directory (appData/vrmlpad) so
// existing users don't lose their saved window position.
function legacyWindowStatePath(userDataPath) {
  return path.join(path.dirname(userDataPath), 'vrmlpad', WINDOW_STATE_FILENAME);
}

// A saved position is only usable if it lands on a display that's actually
// connected right now -- otherwise (unplugged monitor, or an RDP session
// only forwarding one display) fall back to whatever display is visible.
function isVisibleOnAnyDisplay(bounds, displays) {
  return displays.some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

module.exports = {
  WINDOW_STATE_FILENAME,
  DEFAULT_WINDOW_STATE,
  windowStatePath,
  legacyWindowStatePath,
  isVisibleOnAnyDisplay,
};
