'use strict';
// Minimal, read-only app settings (Phase 6A). A tiny JSON file under Electron's
// per-platform userData dir lets a user configure things that vary by machine —
// today just the external editor command (`editorCommand`), so a Windows user
// with VSCodium in a non-standard location, or anyone preferring a different
// editor, can point the app at it without an env var.
//
// Pure/injectable (readFile injected); tolerant of a missing/garbage file (falls
// back to defaults). Read-only: this module never writes the file — a user
// creates/edits `settings.json` themselves. Cross-platform: the path comes from
// Electron's userData, and only `path` arithmetic is used.

const path = require('path');

const SETTINGS_FILENAME = 'settings.json';
const DEFAULT_SETTINGS = { editorCommand: null };

function settingsPath(userDataPath) {
  return path.join(userDataPath, SETTINGS_FILENAME);
}

// Load settings from userData. deps: { readFile(path)->string }. Any error
// (missing file, bad JSON) yields the defaults — settings are best-effort.
function loadSettings(userDataPath, deps = {}) {
  const readFile = deps.readFile || ((p) => require('fs').readFileSync(p, 'utf8'));
  let parsed = {};
  try {
    parsed = JSON.parse(readFile(settingsPath(userDataPath))) || {};
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const out = { ...DEFAULT_SETTINGS };
  if (typeof parsed.editorCommand === 'string' && parsed.editorCommand.trim()) {
    out.editorCommand = parsed.editorCommand.trim();
  }
  return out;
}

module.exports = { SETTINGS_FILENAME, DEFAULT_SETTINGS, settingsPath, loadSettings };
