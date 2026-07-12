'use strict';

const MAX_GZIP = 80 * 1024;

let state = null; // { mallPath, editFile }
let pollTimer = null;

const els = {
  openBtn: document.getElementById('openBtn'),
  checkBtn: document.getElementById('checkBtn'),
  repackBtn: document.getElementById('repackBtn'),
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
    const div = document.createElement('div');
    div.className = `check ${r.pass ? 'pass' : 'fail'} ${r.severity}`;
    div.innerHTML = `<span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span><span>${r.name}</span>` +
      (r.detail ? `<span class="detail">— ${r.detail}</span>` : '');
    els.results.appendChild(div);
  }
}

function applyState(data) {
  state = { mallPath: data.mallPath, editFile: data.editFile };
  els.empty.style.display = 'none';
  els.loaded.style.display = 'block';
  els.mallPath.textContent = data.mallPath;
  els.editFile.textContent = data.editFile;
  els.checkBtn.disabled = false;
  els.repackBtn.disabled = false;
  renderResults(data);
  startPolling();
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

els.revealMall.addEventListener('click', (e) => {
  e.preventDefault();
  if (state) window.vrmlpad.revealInFolder(state.mallPath);
});

els.revealEdit.addEventListener('click', (e) => {
  e.preventDefault();
  if (state) window.vrmlpad.revealInFolder(state.editFile);
});
