'use strict';

// The Mall upload limit is NOT duplicated here. Every payload carries
// `mallUploadMaxBytes` from validator.js, so the renderer can never drift from
// the one authoritative constant (see docs/MALL_SIZE_CONTRACT.md).

// Words, not colours. Assistive technology and greyscale both need the state
// spelled out, so every size state has a literal label.
const SIZE_VERDICT_LABEL = {
  pass: 'PASS',
  fail: 'FAIL',
  stale: 'STALE',
  unknown: 'NOT VERIFIED',
};

// Why the size is (or is not) authoritative. Each string names the source of
// the number shown above it.
const SIZE_NOTE = {
  'measured': 'Upload size measured from the gzip artifact on disk.',
  'stale-artifact': 'Upload size not verified for current edits — the existing artifact is stale. The figure on the right is a prediction, not a measurement.',
  'unverified-artifact': 'Upload size not verified — a gzip artifact exists but could not be proven to match the current text. The figure on the right is a prediction, not a measurement.',
  'no-gzip-artifact': 'Upload size not verified — no gzip upload artifact exists. The figure on the right is a prediction, not a measurement.',
};

let state = null; // { mallPath, editFile }
let pollTimer = null;

const els = {
  openBtn: document.getElementById('openBtn'),
  checkBtn: document.getElementById('checkBtn'),
  repackBtn: document.getElementById('repackBtn'),
  editorBtn: document.getElementById('editorBtn'),
  vscodiumBtn: document.getElementById('vscodiumBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  toggleGzip: document.getElementById('toggleGzip'),
  empty: document.getElementById('empty'),
  loaded: document.getElementById('loaded'),
  mallPath: document.getElementById('mallPath'),
  editFile: document.getElementById('editFile'),
  revealMall: document.getElementById('revealMall'),
  revealEdit: document.getElementById('revealEdit'),
  textSize: document.getElementById('textSize'),
  artifactSize: document.getElementById('artifactSize'),
  predictedSize: document.getElementById('predictedSize'),
  sizeVerdict: document.getElementById('sizeVerdict'),
  textStat: document.getElementById('textStat'),
  artifactStat: document.getElementById('artifactStat'),
  predictedStat: document.getElementById('predictedStat'),
  sizeNote: document.getElementById('sizeNote'),
  results: document.getElementById('results'),
};

// Render the three size facts. The middle tile is the only one that carries a
// verdict, because it is the only one measured from the file that gets
// uploaded: `artifactBytes` is null whenever no gzip artifact has been weighed,
// and in that state the tile shows a dash and "NOT VERIFIED" rather than
// borrowing the prediction beside it.
function renderSizes(data) {
  const n = (v) => Number(v).toLocaleString();
  const status = data.sizeStatus || 'unknown';

  els.textSize.textContent = data.textBytes == null ? '-' : n(data.textBytes);
  els.predictedSize.textContent = data.predictedRepackBytes == null ? '-' : n(data.predictedRepackBytes);

  // A measured number appears here ONLY when the artifact was proven to match
  // the current text. A stale artifact's byte count is a real measurement of
  // the wrong document, so it is not shown as this document's upload size.
  const measured = status === 'pass' || status === 'fail';
  els.artifactSize.textContent = measured ? n(data.artifactBytes) : '-';
  els.sizeVerdict.textContent = SIZE_VERDICT_LABEL[status] || 'NOT VERIFIED';

  for (const s of ['size-pass', 'size-fail', 'size-stale', 'size-unknown']) {
    els.artifactStat.classList.remove(s);
  }
  els.artifactStat.classList.add(`size-${status}`);
  els.artifactStat.classList.toggle('over', status === 'fail');

  const limit = data.mallUploadMaxBytes;
  els.artifactStat.setAttribute('aria-label', measured
    ? `Upload size measured ${n(data.artifactBytes)} bytes, limit ${n(limit)} bytes, ${SIZE_VERDICT_LABEL[status]}`
    : `Upload size ${SIZE_VERDICT_LABEL[status] || 'NOT VERIFIED'}, limit ${limit == null ? 'unknown' : `${n(limit)} bytes`}`);

  let note = SIZE_NOTE[data.sizeReason] || SIZE_NOTE['no-gzip-artifact'];
  if (measured && limit != null) note += ` Limit ${n(limit)} B.`;
  els.sizeNote.textContent = note;
}

// Lane B B2 -- the save outcome, rendered in the EXISTING results list rather
// than a new modal or panel. An ESIZE refusal is the case that matters: it must
// print the verified pre-write CANDIDATE size, the exact limit, the overage,
// and the fact that the existing file was not changed. The candidate is never
// called the measured upload artifact -- Lane A owns that wording, and the
// measured tile above still describes the file that really is on disk.
function saveOutcomeRow(data) {
  if (!data || data.errorCode == null) {
    // A preserved no-op is worth stating: "nothing was written" is a result,
    // not a silence.
    if (data && data.saved === true && data.preserved === true) {
      return { name: 'Repack', status: 'pass', severity: 'info', detail: data.message };
    }
    return null;
  }
  const n = (v) => Number(v).toLocaleString();
  let detail = data.message || 'Not saved.';
  if (data.errorCode === 'ESIZE' && data.candidateBytes != null) {
    detail = `verified pre-write candidate ${n(data.candidateBytes)} B, over the `
      + `${n(data.maxBytes)} B limit by ${n(data.overBytes)} B — the existing file was not changed`;
  }
  return { name: `Repack refused (${data.errorCode})`, status: 'fail', severity: 'hard', detail };
}

function renderResults(data) {
  renderSizes(data);

  els.results.innerHTML = '';
  const outcome = saveOutcomeRow(data);
  if (outcome) {
    const div = document.createElement('div');
    div.className = `check ${outcome.status} ${outcome.severity}`;
    div.innerHTML = `<span class="badge">${outcome.status === 'pass' ? 'PASS' : 'FAIL'}</span>`
      + `<span>${outcome.name}</span><span class="detail">— ${outcome.detail}</span>`;
    els.results.appendChild(div);
  }
  for (const r of data.results) {
    // Suppress the validator's advisory, untransformed text-bbox placement line
    // when the authoritative transform-aware X_ITE bounds drive the Fit panel
    // above -- showing two placement verdicts from different bounding systems
    // would be contradictory (see AGENTS.md / roadmap Phase 2B1). The other
    // static validator checks (header, WorldInfo, size, textures, DEF/USE, URLs)
    // remain authoritative and are shown unchanged.
    if (/^Placement\/bbox/.test(r.name)) continue;
    // Most rows are pass/fail. The size row carries an explicit `status` because
    // "not verified" is neither -- rendering it as FAIL would invent a defect,
    // rendering it as PASS would invent an approval.
    const status = r.status || (r.pass ? 'pass' : 'fail');
    const badge = SIZE_VERDICT_LABEL[status] || (r.pass ? 'PASS' : 'FAIL');
    const div = document.createElement('div');
    div.className = `check ${status} ${r.severity}`;
    div.innerHTML = `<span class="badge">${badge}</span><span>${r.name}</span>` +
      (r.detail ? `<span class="detail">— ${r.detail}</span>` : '');
    els.results.appendChild(div);
  }
}

// Show / clear the "editor not found" message from a launchEditor result.
function showEditorStatus(status) {
  const el = document.getElementById('editorMsg');
  if (!el) return;
  if (status && status.launched === false && status.reason === 'not-found') {
    el.textContent = '⚠ ' + (status.hint || 'External editor not found.') +
      ' Set WRL_FORGE_EDITOR or editorCommand in settings.json to your editor path.';
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function applyState(data) {
  state = { mallPath: data.mallPath, editFile: data.editFile };
  els.empty.style.display = 'none';
  els.loaded.style.display = 'block';
  // The external editor is optional: opening a file never surfaces an
  // "editor not found" message. That message appears only when the user
  // explicitly requests the external-editor action (see the button handler).
  els.mallPath.textContent = data.mallPath;
  els.editFile.textContent = data.editFile;
  els.checkBtn.disabled = false;
  els.repackBtn.disabled = false;
  els.editorBtn.disabled = false;
  els.vscodiumBtn.disabled = false;
  els.refreshBtn.disabled = false;
  renderResults(data);
  startPolling();
  // Load the item into the embedded X_ITE preview (read-only; never mutates).
  if (window.wrlPreview) window.wrlPreview.load();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!state) return;
    try {
      const data = await window.vrmlpad.check(state.editFile);
      renderResults(data);
    } catch (e) {
      // edit file may briefly not exist during a VSCodium save; ignore
    }
  }, 3000);
}

els.openBtn.addEventListener('click', async () => {
  const data = await window.vrmlpad.openMall();
  if (data) applyState(data);
});

// Switch to the World Project workspace (separate page, same window). The Mall
// Item lane is unchanged; this is a sibling workspace.
const worldBtn = document.getElementById('worldBtn');
if (worldBtn) worldBtn.addEventListener('click', () => window.vrmlpad.goto('world'));

els.checkBtn.addEventListener('click', async () => {
  if (!state) return;
  const data = await window.vrmlpad.check(state.editFile);
  renderResults(data);
});

// Phase: Accessibility + Performance -- the click handler and the Ctrl+R /
// Ctrl+E keyboard shortcuts share ONE action path so the shortcut is never
// an alternative code route. Each handler is a small named function the
// listener dispatches into.
// Lane B B2: the button now reports what actually happened to the file. The
// old code said "Saved ✓" unconditionally, which would announce success for a
// refused or failed write -- the one message a save button must never show
// when nothing was written.
//
// Three outcomes, three labels:
//   preserved   -> 'Already saved ✓'  the existing gzip artifact already
//                  matched this text, so it was deliberately NOT rewritten.
//   real write  -> 'Saved ✓'
//   refused or  -> 'Not saved'        the file on disk is unchanged; the
//   failed                            reason is spelled out in the results.
function repackButtonLabel(data) {
  if (!data || data.saved !== true) return 'Not saved';
  return data.preserved === true ? 'Already saved ✓' : 'Saved ✓';
}

async function doRepack() {
  if (!state) return;
  const asGzip = els.toggleGzip.checked;
  let data = null;
  try {
    data = await window.vrmlpad.repack(state.mallPath, state.editFile, asGzip);
  } catch (e) {
    // An IPC-level failure is still "nothing was written" from the user's
    // point of view -- never fall through to the success label.
    data = null;
  }
  if (data) renderResults(data);
  els.repackBtn.textContent = repackButtonLabel(data);
  setTimeout(() => { els.repackBtn.textContent = 'Repack & Save to mall .wrl'; }, 1500);
}

els.repackBtn.addEventListener('click', doRepack);

// Open the current mall .wrl in the native editor (gzip-transparent, edits the
// real source directly -- no .edit.wrl sibling needed), then switch to the editor
// page. Returning Back preserves the buffer.
async function doOpenInNativeEditor() {
  if (!state) return;
  try {
    await window.vrmlpad.editor.openMall();
    await window.vrmlpad.goto('editor');
  } catch (e) { showEditorStatus({ launched: false }); }
}

els.editorBtn.addEventListener('click', doOpenInNativeEditor);

// Phase: Accessibility + Performance -- app-level accelerator shortcuts.
// Ctrl+R calls the existing Repack action; Ctrl+E calls the existing Open in
// Native Editor action. Both are advertised through aria-keyshortcuts on the
// buttons (see renderer/index.html). Suppression rules match the editor's
// policy: do not steal a keystroke that belongs to a text entry, a modal, or
// content-editable region. Ctrl+L / Ctrl+O are intentionally NOT wired --
// the GTK file-open dialog gotcha (AGENTS.md §"Known gotchas") makes them
// unreliable here.
function shortcutSuppressed(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  if (document.querySelector('.modal-backdrop.show')) return true;
  return false;
}

window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  if (e.altKey) return;
  const k = String(e.key || '').toLowerCase();
  if (k !== 'r' && k !== 'e') return;
  if (shortcutSuppressed(e.target)) return;
  if (k === 'r') {
    // Don't fire while the button is disabled -- respect the existing toolbar
    // state model.
    if (els.repackBtn.disabled) return;
    e.preventDefault();
    doRepack();
  } else if (k === 'e') {
    if (els.editorBtn.disabled) return;
    e.preventDefault();
    doOpenInNativeEditor();
  }
});

els.vscodiumBtn.addEventListener('click', async () => {
  try {
    const res = await window.vrmlpad.openInEditor();
    if (res) showEditorStatus(res.editorStatus);
  } catch (e) { /* no file open */ }
});

// Phase: Preferences & Settings -- one Preferences button on the Mall
// toolbar opens the shared dialog (same one the World + Editor toolbars
// open). The button itself is in renderer/index.html; the click wires to
// the shared module loaded just before this script.
const prefsBtn = document.getElementById('prefsBtn');
if (prefsBtn && window.WrlPreferences) {
  prefsBtn.addEventListener('click', () => window.WrlPreferences.show(prefsBtn));
}

els.revealMall.addEventListener('click', (e) => {
  e.preventDefault();
  if (state) window.vrmlpad.revealInFolder(state.mallPath);
});

els.revealEdit.addEventListener('click', (e) => {
  e.preventDefault();
  if (state) window.vrmlpad.revealInFolder(state.editFile);
});

// Exposed only for the non-interactive QA/screenshot harness (main.js
// WRL_FORGE_PREVIEW_CAPTURE), so it can drive the real open->validate->preview
// path headlessly. It wraps applyState over data from already-exposed IPC and
// adds no new capability or privilege.
window.__wrlForgeApplyOpen = applyState;

// Phase: Accessibility + Performance -- when arriving back from the editor
// via `← Back`, restore focus to the originating workspace's primary action.
// The sessionStorage key is set by editor.doBack() and consumed exactly once
// here. A missing/disabled target silently does nothing (no error, no throw).
(function restoreReturnFocus() {
  try {
    const id = window.sessionStorage.getItem('wrlforge.nav.returnFocusId');
    if (!id) return;
    window.sessionStorage.removeItem('wrlforge.nav.returnFocusId');
    const el = document.getElementById(id);
    if (!el || el.disabled) return;
    // Defer until the button is enabled (applyState may run later). Retry a
    // few times cheaply; once focus succeeds or the budget is exhausted,
    // stop.
    let tries = 0;
    const tick = () => {
      tries += 1;
      const target = document.getElementById(id);
      if (target && !target.disabled) { target.focus(); return; }
      if (tries < 40) setTimeout(tick, 50);
    };
    setTimeout(tick, 0);
  } catch (e) { /* sessionStorage unavailable -- nothing to restore */ }
})();

// Phase Beta 2 -- at app start, the Mall page is the default landing. If a
// recovery snapshot exists, raise the Restore / Start Fresh prompt here; it
// navigates to the editor on Restore. A failed probe never blocks page load.
if (window.WRLForgeRecoveryPrompt && typeof window.WRLForgeRecoveryPrompt.maybePrompt === 'function') {
  // The Mall page does not need to refresh after Restore -- the prompt module
  // navigates to /editor and the editor page's init handles the rest.
  window.WRLForgeRecoveryPrompt.maybePrompt();
}
