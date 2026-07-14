'use strict';
// Pure native-editor UI view-models (Phase 7B). Everything the editor workspace
// renders -- toolbar enable/disable, the status bar, the outline rows, the
// conflict-dialog decision, keyboard-shortcut dispatch, stale-analysis rejection
// -- is computed here from plain data, so it unit-tests in Node with no DOM.
// renderer/editor.js is a thin binding that maps these models onto elements.

const DIAG_CAP = 200; // cap visible diagnostics/advisories; the true total is kept

// Built-in editor themes (must mirror the palette ids in browser/editor-view.js).
// Two light-on-dark, one dark-on-light, one terminal green, and a pure-black
// High Contrast theme for low-vision use.
const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'tokyo', label: 'Tokyo Night' },
  { id: 'contrast', label: 'High Contrast' },
];
const DEFAULT_THEME = 'dark';
function isValidTheme(id) { return THEMES.some((t) => t.id === id); }
// A saved/requested theme falls back to the default when absent or unknown.
function resolveTheme(id) { return isValidTheme(id) ? id : DEFAULT_THEME; }

// --- zoom model (single source of truth for code font + chrome scale) --------
// One integer "zoom level" scales BOTH the CodeMirror code area (codeFontPx, fed
// to the editor handle's setFontSize) and the app chrome (chromeScale, applied
// as the --wrl-ui-scale CSS variable). Keeping both in one pure model means they
// can never drift. Bounds mirror MIN/MAX_FONT_PX in browser/editor-view.js.
const ZOOM_MIN = -3;
const ZOOM_MAX = 8;
const ZOOM_DEFAULT = 0;
const ZOOM_BASE_FONT_PX = 13; // matches editor-view DEFAULT_FONT_PX
const ZOOM_MIN_FONT_PX = 9;   // matches editor-view MIN_FONT_PX
const ZOOM_MAX_FONT_PX = 28;  // matches editor-view MAX_FONT_PX

function clampZoom(level) {
  const n = Math.round(Number(level));
  if (!Number.isFinite(n)) return ZOOM_DEFAULT;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n));
}
// A persisted/typed value -> a valid level (defaults on absent/garbage).
function resolveZoom(raw) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? clampZoom(n) : ZOOM_DEFAULT;
}
function zoomStep(level, delta) { return clampZoom(clampZoom(level) + Math.round(Number(delta) || 0)); }
// The derived view-model for a level: 10% per step, clamped font, percent label.
function zoomModel(level) {
  const lv = clampZoom(level);
  const factor = 1 + lv * 0.1; // lv -3..+8 -> 0.7..1.8
  const codeFontPx = Math.max(ZOOM_MIN_FONT_PX, Math.min(ZOOM_MAX_FONT_PX, Math.round(ZOOM_BASE_FONT_PX * factor)));
  return { level: lv, codeFontPx, chromeScale: factor, label: Math.round(factor * 100) + '%' };
}

const FORMAT_LABEL = { plain: 'Plain', gzip: 'gzip' };
function formatLabel(format) { return FORMAT_LABEL[format] || 'Plain'; }

// The renderer is the source of truth for buffer text (avoids an IPC round-trip
// per keystroke); dirty is a pure comparison against the opened/last-saved text.
function isDirty(current, baseline) { return current !== baseline; }

const SAVE_STATE = Object.freeze({
  CLEAN: 'clean', DIRTY: 'dirty', SAVING: 'saving', SAVED: 'saved', ERROR: 'error', CONFLICT: 'conflict',
});
function saveStateLabel(s) {
  switch (s) {
    case SAVE_STATE.SAVING: return 'Saving…';
    case SAVE_STATE.SAVED: return 'Saved';
    case SAVE_STATE.ERROR: return 'Save failed';
    case SAVE_STATE.CONFLICT: return 'File changed on disk';
    case SAVE_STATE.DIRTY: return 'Unsaved changes';
    default: return 'No changes';
  }
}

function basename(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || String(p);
}

function cursorLabel(cursor) {
  const line = cursor && cursor.line ? cursor.line : 1;
  const col = cursor && cursor.column ? cursor.column : 1;
  return `Ln ${line}, Col ${col}`;
}

// Cap a diagnostics/advisories list for display while retaining the total.
function capDiagnostics(list, cap = DIAG_CAP) {
  const all = Array.isArray(list) ? list : [];
  const shown = all.slice(0, cap);
  return { shown, total: all.length, hidden: Math.max(0, all.length - shown.length), capped: all.length > shown.length };
}

// The complete status-bar model. `saveState` (optional) overrides the derived
// clean/dirty state during a save lifecycle.
function statusModel({ describe, cursor, diagnostics, advisories, saveState } = {}) {
  const d = describe || { open: false };
  const effective = saveState || (d.dirty ? SAVE_STATE.DIRTY : SAVE_STATE.CLEAN);
  return {
    open: !!d.open,
    fileName: d.open ? basename(d.sourcePath) : '',
    sourcePath: d.open ? d.sourcePath : '',
    format: d.open ? formatLabel(d.format) : '',
    gzip: !!(d.open && d.gzip),
    dirty: !!(d.open && d.dirty),
    cursor: cursorLabel(cursor),
    diagnosticCount: (diagnostics || []).length,
    advisoryCount: (advisories || []).length,
    saveState: effective,
    saveLabel: saveStateLabel(effective),
    context: d.context || 'generic',
  };
}

// Toolbar enable/disable. Save is offered only when there is something to save;
// everything else needs an open, non-saving document.
function toolbarModel({ open = false, dirty = false, saving = false } = {}) {
  const active = open && !saving;
  return {
    save: { enabled: active && dirty },
    saveAs: { enabled: active },
    reload: { enabled: active },
    undo: { enabled: active },
    redo: { enabled: active },
    find: { enabled: active },
    replace: { enabled: active },
    gotoLine: { enabled: active },
    close: { enabled: open && !saving },
    external: { enabled: active },
  };
}

// Flatten the nested AST outline into rows carrying depth + a navigation target
// (the source range to reveal on click).
function flattenOutline(outline, depth = 0, into = []) {
  for (const e of outline || []) {
    into.push({ label: e.label, kind: e.kind, depth, from: e.from, to: e.to, line: e.line });
    if (e.children && e.children.length) flattenOutline(e.children, depth + 1, into);
  }
  return into;
}

// Where a Back button returns to, from the document's originating context.
function originNav(context) {
  if (context === 'world') return { page: 'world', label: 'Back to World Project' };
  if (context === 'mall') return { page: 'mall', label: 'Back to Mall Item' };
  return { page: 'mall', label: 'Back' };
}

// Conflict-dialog choice (external change detected) -> the action to take.
const CONFLICT_ACTION = Object.freeze({ RELOAD: 'reload', SAVE_AS: 'saveAs', CANCEL: 'cancel' });
function conflictDecision(choice) {
  switch (choice) {
    case 'reload': return { action: CONFLICT_ACTION.RELOAD, discardsBuffer: true };
    case 'saveAs': return { action: CONFLICT_ACTION.SAVE_AS, discardsBuffer: false };
    default: return { action: CONFLICT_ACTION.CANCEL, discardsBuffer: false };
  }
}

// Does closing (or reloading) now require an "unsaved changes" confirmation?
function needsUnsavedConfirm({ dirty } = {}) { return !!dirty; }

// App-level keyboard shortcut resolver. CodeMirror owns Undo/Redo/Find/Replace
// through its own keymap; these are the app-level accelerators editor.js
// intercepts. Returns a command name or null.
function resolveShortcut({ key, ctrlOrMeta, shift } = {}) {
  if (!ctrlOrMeta) return null;
  const k = String(key || '').toLowerCase();
  if (k === 's') return shift ? 'saveAs' : 'save';
  if (k === 'g' && !shift) return 'gotoLine';
  if (k === 'w' && !shift) return 'close';
  // Zoom accelerators: Ctrl/Cmd with +/=/-/0 (both the shifted and unshifted
  // punctuation forms are accepted so any keyboard layout reaches them).
  if (k === '=' || k === '+' || k === 'add') return 'zoomIn';
  if (k === '-' || k === '_' || k === 'subtract') return 'zoomOut';
  if (k === '0') return 'zoomReset';
  return null;
}

// Stale-analysis rejection: apply an analysis result only if it is at least as
// new as the last one applied (a late/out-of-order callback for an older buffer
// version is dropped). Belt-and-suspenders over the editor view's own guard.
function isFreshAnalysis(resultVersion, appliedVersion) {
  return typeof resultVersion === 'number' && resultVersion >= (appliedVersion || 0);
}

const API = {
  DIAG_CAP, SAVE_STATE, CONFLICT_ACTION, THEMES, DEFAULT_THEME,
  ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT,
  formatLabel, isDirty, saveStateLabel, basename, cursorLabel,
  capDiagnostics, statusModel, toolbarModel, flattenOutline,
  originNav, conflictDecision, needsUnsavedConfirm, resolveShortcut, isFreshAnalysis,
  isValidTheme, resolveTheme, clampZoom, resolveZoom, zoomStep, zoomModel,
};

// Dual use: CommonJS for Node unit tests, a window global for the renderer (this
// file is loaded by a plain <script> in editor.html -- no bundler on that page).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else {
  window.WrlEditorUI = API;
}
