'use strict';
// Native editor workspace binding (Phase 7B). Thin DOM glue: all decisions come
// from window.WrlEditorUI (pure, unit-tested), the editing surface from
// window.WrlEditor (CodeMirror bundle), and every filesystem/path action from
// window.vrmlpad.editor (the confined main-process controller). The renderer is
// the source of truth for buffer text (no IPC per keystroke); it pushes the
// buffer to main only on save/navigate, and computes dirty locally vs. baseline.

const UI = window.WrlEditorUI;
const bridge = window.vrmlpad.editor;

const el = (id) => document.getElementById(id);
const els = {
  back: el('backBtn'), save: el('saveBtn'), saveAs: el('saveAsBtn'), reload: el('reloadBtn'),
  undo: el('undoBtn'), redo: el('redoBtn'), find: el('findBtn'), replace: el('replaceBtn'),
  goto: el('gotoBtn'), external: el('externalBtn'), close: el('closeBtn'),
  editor: el('editor'), msg: el('editorMsg'),
  outlineList: el('outlineList'), diagList: el('diagList'), advList: el('advList'),
  diagCount: el('diagCount'), advCount: el('advCount'),
  stFile: el('stFile'), stFormat: el('stFormat'), stDirty: el('stDirty'), stSave: el('stSave'),
  stCursor: el('stCursor'), stDiag: el('stDiag'), stAdv: el('stAdv'),
  themeSelect: el('themeSelect'),
};

// Theme preference persists across sessions in the renderer (a cosmetic setting;
// losing it is harmless). localStorage on the app's local page is stable.
const THEME_KEY = 'wrlforge.editor.theme';
function savedTheme() {
  try { return UI.resolveTheme(window.localStorage.getItem(THEME_KEY)); } catch (e) { return UI.DEFAULT_THEME; }
}
function persistTheme(id) {
  try { window.localStorage.setItem(THEME_KEY, id); } catch (e) { /* best-effort */ }
}

// --- renderer-local editor state --------------------------------------------
const S = {
  handle: null,
  sessionId: null,
  context: 'generic',
  sourcePath: '',
  format: 'plain',
  gzip: false,
  baseline: '',           // opened / last-saved text; dirty = current !== baseline
  cursor: { line: 1, column: 1 },
  diagnostics: [],
  advisories: [],
  outline: [],
  appliedAnalysisVersion: 0,
  saving: false,
  saveState: null,        // overrides derived clean/dirty during the save lifecycle
};

function currentText() { return S.handle ? S.handle.getText() : S.baseline; }
function isDirty() { return UI.isDirty(currentText(), S.baseline); }

// --- rendering ---------------------------------------------------------------
function render() {
  const describe = {
    open: !!S.handle, sourcePath: S.sourcePath, format: S.format, gzip: S.gzip,
    dirty: isDirty(), context: S.context,
  };
  const status = UI.statusModel({
    describe, cursor: S.cursor, diagnostics: S.diagnostics, advisories: S.advisories, saveState: S.saveState,
  });
  const tb = UI.toolbarModel({ open: status.open, dirty: status.dirty, saving: S.saving });

  els.save.disabled = !tb.save.enabled;
  els.saveAs.disabled = !tb.saveAs.enabled;
  els.reload.disabled = !tb.reload.enabled;
  els.undo.disabled = !tb.undo.enabled;
  els.redo.disabled = !tb.redo.enabled;
  els.find.disabled = !tb.find.enabled;
  els.replace.disabled = !tb.replace.enabled;
  els.goto.disabled = !tb.gotoLine.enabled;
  els.external.disabled = !tb.external.enabled;
  els.close.disabled = !tb.close.enabled;

  els.stFile.textContent = status.fileName || '—';
  els.stFile.title = status.sourcePath || '';
  els.stFormat.textContent = status.open ? status.format : '';
  els.stDirty.innerHTML = status.dirty ? '<span class="dirty-dot">●</span> Modified' : '';
  els.stSave.textContent = status.saveLabel;
  els.stSave.className = 'seg save-' + status.saveState;
  els.stCursor.textContent = status.cursor;
  els.stDiag.textContent = String(status.diagnosticCount);
  els.stAdv.textContent = String(status.advisoryCount);

  const back = UI.originNav(S.context);
  els.back.textContent = '← ' + back.label;

  renderOutline();
  renderDiagnostics();
}

function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function renderOutline() {
  clearChildren(els.outlineList);
  const rows = UI.flattenOutline(S.outline);
  if (!rows.length) {
    els.outlineList.appendChild(emptyNote(S.handle ? 'No nodes.' : 'No document.'));
    return;
  }
  for (const r of rows) {
    const div = document.createElement('div');
    div.className = 'row-item outline';
    div.style.paddingLeft = (12 + r.depth * 14) + 'px';
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = r.kind === 'node' ? '' : r.kind;
    const label = document.createElement('span');
    label.textContent = r.label;
    div.appendChild(kind);
    div.appendChild(label);
    div.tabIndex = 0;
    const go = () => navigateTo(r.from, r.to);
    div.addEventListener('click', go);
    div.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    els.outlineList.appendChild(div);
  }
}

function renderDiagnostics() {
  const diag = UI.capDiagnostics(S.diagnostics, UI.DIAG_CAP);
  const adv = UI.capDiagnostics(S.advisories, UI.DIAG_CAP);
  els.diagCount.textContent = String(diag.total);
  els.advCount.textContent = String(adv.total);
  fillDiagList(els.diagList, diag, 'No syntax diagnostics.', false);
  fillDiagList(els.advList, adv, 'No advisories.', true);
}

function fillDiagList(container, capped, emptyText, advisory) {
  clearChildren(container);
  if (!capped.total) { container.appendChild(emptyNote(emptyText)); return; }
  for (const d of capped.shown) {
    const div = document.createElement('div');
    div.className = 'row-item ' + (advisory ? 'advisory' : 'sev-' + (d.severity || 'error'));
    const loc = document.createElement('span');
    loc.className = 'loc';
    loc.textContent = `${d.line || 1}:${d.column || 1}`;
    const msg = document.createElement('span');
    msg.textContent = d.message + (d.code ? ` (${d.code})` : '');
    div.appendChild(loc);
    div.appendChild(msg);
    div.tabIndex = 0;
    const go = () => navigateTo(d.from, d.to);
    div.addEventListener('click', go);
    div.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    container.appendChild(div);
  }
  if (capped.capped) {
    const note = emptyNote(`Showing ${capped.shown.length} of ${capped.total}; ${capped.hidden} more not listed.`);
    container.appendChild(note);
  }
}

function emptyNote(text) {
  const n = document.createElement('div');
  n.className = 'empty-note';
  n.textContent = text;
  return n;
}

function navigateTo(from, to) {
  if (!S.handle || from == null) return;
  S.handle.revealRange(from, to == null ? from : to);
}

function showMsg(text, isErr) {
  els.msg.textContent = text;
  els.msg.className = 'editor-msg' + (isErr ? ' err' : '');
  els.msg.style.display = text ? 'block' : 'none';
}

// --- in-DOM modal (no native alert/confirm/prompt) --------------------------
function showModal({ title, message, buttons, input }) {
  return new Promise((resolve) => {
    const backdrop = el('modalBackdrop');
    el('modalTitle').textContent = title;
    el('modalMsg').textContent = message || '';
    const inputEl = el('modalInput');
    if (input) {
      inputEl.type = input.type || 'text';
      inputEl.value = input.value != null ? String(input.value) : '';
      inputEl.style.display = 'block';
    } else {
      inputEl.style.display = 'none';
    }
    const actions = el('modalActions');
    clearChildren(actions);
    const finish = (value) => { backdrop.classList.remove('show'); resolve(input ? { value, input: inputEl.value } : { value }); };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (!b.primary) btn.className = 'secondary';
      btn.addEventListener('click', () => finish(b.value));
      actions.appendChild(btn);
    }
    backdrop.classList.add('show');
    (input ? inputEl : actions.lastChild).focus();
  });
}

async function confirmUnsaved(actionLabel) {
  if (!isDirty()) return true;
  const r = await showModal({
    title: 'Discard unsaved changes?',
    message: `This document has unsaved changes. ${actionLabel} anyway?`,
    buttons: [
      { label: actionLabel, value: 'ok', primary: true },
      { label: 'Keep editing', value: 'cancel' },
    ],
  });
  return r.value === 'ok';
}

// --- actions -----------------------------------------------------------------
async function doSave() {
  if (!S.handle || S.saving || !isDirty()) return;
  S.saving = true; S.saveState = UI.SAVE_STATE.SAVING; render();
  const text = currentText();
  let res;
  try {
    res = await bridge.save(S.sessionId, text, false);
  } catch (e) {
    S.saving = false; S.saveState = UI.SAVE_STATE.ERROR; showMsg('Save failed: ' + e.message, true); render(); return;
  }
  S.saving = false;
  if (res && res.ok) {
    S.baseline = text; S.format = res.format; S.saveState = UI.SAVE_STATE.SAVED; showMsg('', false);
    render();
    return;
  }
  if (res && res.code === 'EEXTERNAL') {
    S.saveState = UI.SAVE_STATE.CONFLICT; render();
    await resolveConflict();
    return;
  }
  S.saveState = UI.SAVE_STATE.ERROR; showMsg('Save failed: ' + (res && res.error || 'unknown error'), true); render();
}

async function resolveConflict() {
  const r = await showModal({
    title: 'File changed on disk',
    message: 'This file was modified outside WRL Forge since you opened it. Reload the on-disk version (discarding your edits), save your version to a new file, or cancel and keep editing.',
    buttons: [
      { label: 'Reload from disk', value: 'reload' },
      { label: 'Save As…', value: 'saveAs', primary: true },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
  const decision = UI.conflictDecision(r.value);
  if (decision.action === UI.CONFLICT_ACTION.RELOAD) await doReload(true);
  else if (decision.action === UI.CONFLICT_ACTION.SAVE_AS) await doSaveAs();
  // Cancel: leave the buffer dirty; the conflict status remains.
}

async function doSaveAs() {
  if (!S.handle || S.saving) return;
  const text = currentText();
  S.saving = true; S.saveState = UI.SAVE_STATE.SAVING; render();
  let res;
  try {
    res = await bridge.saveAs(S.sessionId, text, null); // keep current format
  } catch (e) {
    S.saving = false; S.saveState = UI.SAVE_STATE.ERROR; showMsg('Save As failed: ' + e.message, true); render(); return;
  }
  S.saving = false;
  if (!res || res.canceled) { S.saveState = isDirty() ? UI.SAVE_STATE.DIRTY : UI.SAVE_STATE.CLEAN; render(); return; }
  if (res.ok) {
    S.baseline = text; S.sourcePath = res.sourcePath; S.format = res.format; S.gzip = res.format === 'gzip';
    S.saveState = UI.SAVE_STATE.SAVED; showMsg('', false); render();
  }
}

async function doReload(force) {
  if (!S.handle || S.saving) return;
  if (!force && !(await confirmUnsaved('Reload'))) return;
  let res;
  try {
    res = await bridge.reload(S.sessionId);
  } catch (e) {
    showMsg('Reload failed: ' + e.message, true); return;
  }
  S.handle.setDoc(res.text);
  S.baseline = res.text; S.format = res.format; S.gzip = res.format === 'gzip';
  S.saveState = UI.SAVE_STATE.CLEAN; showMsg('', false); render();
}

async function doGotoLine() {
  if (!S.handle) return;
  const r = await showModal({
    title: 'Go to line',
    message: 'Enter a line number:',
    input: { type: 'number', value: S.cursor.line },
    buttons: [{ label: 'Go', value: 'ok', primary: true }, { label: 'Cancel', value: 'cancel' }],
  });
  if (r.value !== 'ok') return;
  const n = parseInt(r.input, 10);
  if (Number.isFinite(n) && n >= 1) S.handle.gotoLine(n);
}

async function doExternal() {
  try {
    const res = await bridge.openInExternal(S.sessionId);
    const st = res && res.editorStatus;
    if (st && st.launched === false && st.reason === 'not-found') {
      showMsg('⚠ ' + (st.hint || 'External editor not found.') +
        ' Set WRL_FORGE_EDITOR or editorCommand in settings.json to your editor path.', false);
    } else {
      showMsg('', false);
    }
  } catch (e) { showMsg('Could not launch the external editor: ' + e.message, true); }
}

async function doClose() {
  if (!(await confirmUnsaved('Close'))) return;
  const back = UI.originNav(S.context);
  try { await bridge.close(S.sessionId); } catch (e) { /* nothing open */ }
  await window.vrmlpad.goto(back.page);
}

async function doBack() {
  // Preserve the (possibly unsaved) buffer in the main-process session so it
  // survives the page switch, then navigate. The session stays open.
  const back = UI.originNav(S.context);
  if (S.handle && S.sessionId != null) {
    try { await bridge.setText(S.sessionId, currentText()); } catch (e) { /* session may be gone */ }
  }
  await window.vrmlpad.goto(back.page);
}

// --- wiring ------------------------------------------------------------------
function wireButtons() {
  els.save.addEventListener('click', doSave);
  els.saveAs.addEventListener('click', doSaveAs);
  els.reload.addEventListener('click', () => doReload(false));
  els.undo.addEventListener('click', () => S.handle && S.handle.undo());
  els.redo.addEventListener('click', () => S.handle && S.handle.redo());
  els.find.addEventListener('click', () => S.handle && S.handle.openSearch());
  els.replace.addEventListener('click', () => S.handle && S.handle.openSearch());
  els.goto.addEventListener('click', doGotoLine);
  els.external.addEventListener('click', doExternal);
  els.close.addEventListener('click', doClose);
  els.back.addEventListener('click', doBack);

  // App-level accelerators (CodeMirror owns undo/redo/find/replace via its keymap).
  window.addEventListener('keydown', (e) => {
    const cmd = UI.resolveShortcut({ key: e.key, ctrlOrMeta: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    if (!cmd) return;
    e.preventDefault();
    if (cmd === 'save') doSave();
    else if (cmd === 'saveAs') doSaveAs();
    else if (cmd === 'gotoLine') doGotoLine();
    else if (cmd === 'close') doClose();
  });
}

function populateThemes() {
  clearChildren(els.themeSelect);
  for (const t of UI.THEMES) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    els.themeSelect.appendChild(opt);
  }
  els.themeSelect.value = savedTheme();
  els.themeSelect.addEventListener('change', () => {
    const id = UI.resolveTheme(els.themeSelect.value);
    persistTheme(id);
    if (S.handle) S.handle.setTheme(id);
  });
}

function mountEditor(text, profile) {
  S.handle = window.WrlEditor.create(els.editor, {
    doc: text,
    profile,
    theme: savedTheme(),
    onChange: () => { if (S.saveState !== UI.SAVE_STATE.CONFLICT) S.saveState = null; render(); },
    onCursor: (c) => { S.cursor = c; els.stCursor.textContent = UI.cursorLabel(c); },
    onAnalysis: (a) => {
      if (!UI.isFreshAnalysis(a.version, S.appliedAnalysisVersion)) return;
      S.appliedAnalysisVersion = a.version;
      S.diagnostics = a.diagnostics; S.advisories = a.advisories; S.outline = a.outline;
      render();
    },
  });
}

async function init() {
  wireButtons();
  populateThemes();
  let d;
  try { d = await bridge.describe({ includeText: true }); } catch (e) { d = { open: false }; }
  // Cold start / direct navigation: try to restore the most-recent document.
  if (!d.open) {
    try { const r = await bridge.restore(); if (r && r.restored) d = r; } catch (e) { /* none */ }
  }
  if (!d.open) {
    showMsg('No document is open. Open one from the Mall or World workspace.', false);
    render();
    return;
  }
  S.sessionId = d.sessionId;
  S.context = d.context || 'generic';
  S.sourcePath = d.sourcePath;
  S.format = d.format;
  S.gzip = !!d.gzip;
  S.baseline = d.baseline != null ? d.baseline : d.text;
  const profile = d.profile || (S.context === 'world' ? 'world' : S.context === 'mall' ? 'mall-item' : 'generic');
  mountEditor(d.text, profile);
  render();
  S.handle.focus();
}

// Exposed only for the serialized visual-QA capture harness (main.js editor
// jobs). Each method wraps an action the page already performs through its own
// buttons/handle -- it adds no capability or privilege beyond the DOM the editor
// page already has, mirroring the __wrlForge* hooks on the Mall/World pages.
window.__wrlEditor = {
  ready: () => !!S.handle || els.msg.style.display === 'block',
  setText: (t) => {
    if (!S.handle) return false;
    S.handle.view.dispatch({ changes: { from: 0, to: S.handle.getText().length, insert: t } });
    return true;
  },
  click: (id) => { const n = el(id); if (n) n.click(); },
  setTheme: (t) => { els.themeSelect.value = t; els.themeSelect.dispatchEvent(new Event('change')); },
  clickFirst: (sel) => { const n = document.querySelector(sel); if (n) n.click(); return !!n; },
  modalVisible: () => el('modalBackdrop').classList.contains('show'),
  status: () => ({
    file: els.stFile.textContent, format: els.stFormat.textContent, dirty: isDirty(),
    save: els.stSave.textContent, diag: els.stDiag.textContent, adv: els.stAdv.textContent,
    outlineRows: document.querySelectorAll('#outlineList .row-item').length,
  }),
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
