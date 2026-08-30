'use strict';

const MAX_GZIP = 80 * 1024;

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
  rawSize: document.getElementById('rawSize'),
  gzSize: document.getElementById('gzSize'),
  rawStat: document.getElementById('rawStat'),
  gzStat: document.getElementById('gzStat'),
  results: document.getElementById('results'),
};

function renderResults(data) {
  els.rawSize.textContent = data.rawBytes.toLocaleString();
  els.gzSize.textContent = data.gzipBytes.toLocaleString();
  els.gzStat.classList.toggle('over', data.gzipBytes >= MAX_GZIP);

  els.results.innerHTML = '';
  for (const r of data.results) {
    // Suppress the validator's advisory, untransformed text-bbox placement line
    // when the authoritative transform-aware X_ITE bounds drive the Fit panel
    // above -- showing two placement verdicts from different bounding systems
    // would be contradictory (see AGENTS.md / roadmap Phase 2B1). The other
    // static validator checks (header, WorldInfo, size, textures, DEF/USE, URLs)
    // remain authoritative and are shown unchanged.
    if (/^Placement\/bbox/.test(r.name)) continue;
    const div = document.createElement('div');
    div.className = `check ${r.pass ? 'pass' : 'fail'} ${r.severity}`;
    div.innerHTML = `<span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span><span>${r.name}</span>` +
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
  renderResults({ ...data, rawBytes: data.rawBytes, gzipBytes: data.gzipBytes });
});

els.repackBtn.addEventListener('click', async () => {
  if (!state) return;
  const asGzip = els.toggleGzip.checked;
  const data = await window.vrmlpad.repack(state.mallPath, state.editFile, asGzip);
  renderResults(data);
  els.repackBtn.textContent = 'Saved ✓';
  setTimeout(() => { els.repackBtn.textContent = 'Repack & Save to mall .wrl'; }, 1500);
});

// Open the current mall .wrl in the native editor (gzip-transparent, edits the
// real source directly -- no .edit.wrl sibling needed), then switch to the editor
// page. Returning Back preserves the buffer.
els.editorBtn.addEventListener('click', async () => {
  if (!state) return;
  try {
    await window.vrmlpad.editor.openMall();
    await window.vrmlpad.goto('editor');
  } catch (e) { showEditorStatus({ launched: false }); }
});

els.vscodiumBtn.addEventListener('click', async () => {
  try {
    const res = await window.vrmlpad.openInEditor();
    if (res) showEditorStatus(res.editorStatus);
  } catch (e) { /* no file open */ }
});

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

// Phase Beta 2 -- at app start, the Mall page is the default landing. If a
// recovery snapshot exists, raise the Restore / Start Fresh prompt here; it
// navigates to the editor on Restore. A failed probe never blocks page load.
if (window.WRLForgeRecoveryPrompt && typeof window.WRLForgeRecoveryPrompt.maybePrompt === 'function') {
  // The Mall page does not need to refresh after Restore -- the prompt module
  // navigates to /editor and the editor page's init handles the rest.
  window.WRLForgeRecoveryPrompt.maybePrompt();
}
