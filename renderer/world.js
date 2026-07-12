'use strict';
// World Project workspace controller (renderer). Read-only: it only asks the
// main process to open/scan/refresh a project and renders the result. It never
// mutates a file and has no filesystem access of its own -- every path comes
// back from the confined main-process handlers.

const W = (window.vrmlpad && window.vrmlpad.world) || null;

const els = {
  status: document.getElementById('status'),
  empty: document.getElementById('empty'),
  ambiguous: document.getElementById('ambiguous'),
  candidates: document.getElementById('candidates'),
  loaded: document.getElementById('loaded'),
  rootPath: document.getElementById('rootPath'),
  primaryPath: document.getElementById('primaryPath'),
  primarySrc: document.getElementById('primarySrc'),
  scanInfo: document.getElementById('scanInfo'),
  summary: document.getElementById('summary'),
  findings: document.getElementById('findings'),
  filters: document.getElementById('filters'),
  assetRows: document.getElementById('assetRows'),
  tableEmpty: document.getElementById('tableEmpty'),
  tree: document.getElementById('tree'),
  refreshBtn: document.getElementById('refreshBtn'),
  revealBtn: document.getElementById('revealBtn'),
  editorBtn: document.getElementById('editorBtn'),
};

let current = null;   // last applied scan payload
let filter = 'all';

const FILTERS = [
  ['all', 'All'],
  ['present', 'Present'],
  ['missing', 'Missing'],
  ['case-mismatch', 'Case mismatch'],
  ['remote', 'Remote'],
  ['unsafe', 'Unsafe'],
  ['repeated', 'Repeated'],
  ['wrl', 'Nested WRL'],
];

const STATUS_META = {
  'present': ['st-present', 'Present ✓'],
  'missing': ['st-missing', 'Missing ✗'],
  'case-mismatch': ['st-case', 'Case ⚠'],
  'remote': ['st-remote', 'Remote ⃠'],
  'unsafe': ['st-unsafe', 'Unsafe ⃠'],
  'inline-script': ['st-script', 'Script'],
  'malformed': ['st-malformed', 'Malformed'],
};

function humanBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function relTo(root, p) {
  if (!root || !p) return p || '';
  if (p === root) return '.';
  if (p.startsWith(root)) return p.slice(root.length).replace(/^[\\/]/, '');
  return p;
}

function setStatus(msg) { els.status.textContent = msg; }

function showState(which) {
  els.empty.style.display = which === 'empty' ? 'block' : 'none';
  els.ambiguous.style.display = which === 'ambiguous' ? 'block' : 'none';
  els.loaded.style.display = which === 'loaded' ? 'block' : 'none';
}

// ---- detection (open folder / file) ---------------------------------------

async function handleDetection(desc) {
  if (!desc) return; // dialog canceled
  const canRefresh = !!desc.primary;
  els.refreshBtn.disabled = !canRefresh;
  els.revealBtn.disabled = !desc.root;
  els.editorBtn.disabled = !desc.primary;

  if (desc.empty) {
    showState('empty');
    els.empty.textContent = `No .wrl / .wrz files found under ${desc.root}. Pick a different folder or open a primary WRL directly.`;
    setStatus('No world files found in that folder.');
    return;
  }
  if (desc.ambiguous) {
    renderCandidates(desc.candidates);
    showState('ambiguous');
    setStatus(`Ambiguous: ${desc.candidates.length} candidate world files — choose the primary.`);
    return;
  }
  if (desc.primary) {
    setStatus('Scanning…');
    const payload = await W.scanProject();
    applyScan(payload);
  }
}

function renderCandidates(candidates) {
  els.candidates.innerHTML = '';
  for (const c of candidates) {
    const b = document.createElement('button');
    b.textContent = `${c.relative}  (${humanBytes(c.bytes)})`;
    b.addEventListener('click', async () => {
      await W.choosePrimary(c.path);
      setStatus('Scanning…');
      applyScan(await W.scanProject());
    });
    els.candidates.appendChild(b);
    els.candidates.appendChild(document.createTextNode(' '));
  }
}

// ---- render a scan --------------------------------------------------------

function applyScan(payload) {
  if (!payload) return;
  if (payload.status === 'busy') { setStatus('A scan is already in progress…'); return; }
  if (!payload.ok && payload.status === 'error' && !payload.summary) {
    setStatus(`Scan failed: ${payload.error || 'unknown error'}`);
    return;
  }
  current = payload;
  showState('loaded');
  els.refreshBtn.disabled = false;
  els.revealBtn.disabled = false;
  els.editorBtn.disabled = false;

  els.rootPath.textContent = payload.root || '—';
  els.primaryPath.textContent = payload.primary || '—';
  els.primarySrc.textContent = payload.primaryGzip ? '(gzip-compressed)' : '(plain text)';
  const parts = [];
  if (payload.scanMs != null) parts.push(`${payload.scanMs} ms`);
  parts.push(payload.status === 'ok' ? 'ok' : payload.status);
  if (payload.stale) parts.push('showing last good result (rescan errored)');
  if (payload.truncated) parts.push('graph truncated at node cap');
  if (payload.depthCapped) parts.push('nesting depth-capped');
  els.scanInfo.textContent = parts.join(' · ');

  renderSummary(payload.summary);
  renderFindings(payload.summary.findings);
  renderFilters();
  renderTable();
  renderTree(payload);
  setStatus(`Scanned ${payload.summary.totalWrlFiles} WRL file(s), ${payload.summary.totalReferences} reference(s).`);
}

function stat(label, value, cls) {
  const d = document.createElement('div');
  d.className = 'stat' + (cls ? ' ' + cls : '');
  d.innerHTML = `<div class="n"></div><div class="l"></div>`;
  d.querySelector('.n').textContent = value;
  d.querySelector('.l').textContent = label;
  return d;
}

function renderSummary(s) {
  els.summary.innerHTML = '';
  const add = (label, value, cls) => els.summary.appendChild(stat(label, value, cls));
  add('WRL files', s.totalWrlFiles);
  add('References', s.totalReferences);
  add('Unique textures', s.uniqueTextures);
  add('Local assets', s.totalLocalAssets);
  add('Missing', s.missing, s.missing ? 'err' : '');
  add('Case mismatch', s.caseMismatches, s.caseMismatches ? 'err' : '');
  add('Remote', s.remoteReferences, s.remoteReferences ? 'warn' : '');
  add('Unsafe', s.unsafePaths, s.unsafePaths ? 'err' : '');
  add('Cycles', s.dependencyCycles, s.dependencyCycles ? 'warn' : '');
  add('Repeated', s.duplicateReferences);
  add('Inline scripts', s.inlineScripts);
  add('Viewpoints', s.viewpoints);
  add('Scripts', s.scripts);
  add('Approx bytes', humanBytes(s.approxTotalBytes));
}

function renderFindings(findings) {
  els.findings.innerHTML = '';
  for (const f of findings || []) {
    const d = document.createElement('div');
    d.className = 'finding ' + f.severity;
    const sev = f.severity === 'error' ? 'ERROR' : f.severity === 'warning' ? 'WARNING' : 'INFO';
    d.innerHTML = `<span class="sev"></span><span class="msg"></span><span class="conf"></span>`;
    d.querySelector('.sev').textContent = sev;
    d.querySelector('.msg').textContent = f.message;
    d.querySelector('.conf').textContent = f.confidence;
    els.findings.appendChild(d);
  }
}

function renderFilters() {
  els.filters.innerHTML = '';
  for (const [key, label] of FILTERS) {
    const b = document.createElement('button');
    b.textContent = label;
    if (key === filter) b.classList.add('active');
    b.addEventListener('click', () => { filter = key; renderFilters(); renderTable(); });
    els.filters.appendChild(b);
  }
}

// Aggregate occurrence-level references into one row per distinct target.
function aggregate(references) {
  const map = new Map();
  for (const r of references || []) {
    const key = r.resolved || `${r.category}:${r.authoredUrl}`;
    let row = map.get(key);
    if (!row) {
      row = {
        status: r.status, kind: r.kind || r.category, authoredUrl: r.authoredUrl,
        projectRelative: r.projectRelative, resolved: r.resolved,
        referrers: new Set(), refCount: 0, bytes: r.bytes, dimensions: r.dimensions,
        minDepth: r.depth, notes: new Set(),
      };
      map.set(key, row);
    }
    row.refCount += 1;
    if (r.referrerRelative) row.referrers.add(r.referrerRelative);
    if (r.bytes != null && row.bytes == null) row.bytes = r.bytes;
    if (r.dimensions && !row.dimensions) row.dimensions = r.dimensions;
    if (r.depth < row.minDepth) row.minDepth = r.depth;
    for (const w of r.warnings || []) row.notes.add(w);
  }
  return [...map.values()];
}

function matchesFilter(row) {
  switch (filter) {
    case 'all': return true;
    case 'repeated': return row.refCount > 1;
    case 'wrl': return row.kind === 'wrl';
    default: return row.status === filter;
  }
}

function renderTable() {
  els.assetRows.innerHTML = '';
  const rows = aggregate(current.references).filter(matchesFilter);
  // Errors first, then by asset name.
  const rank = { missing: 0, 'case-mismatch': 1, unsafe: 2, remote: 3, present: 4, 'inline-script': 5, malformed: 6 };
  rows.sort((a, b) => (rank[a.status] - rank[b.status]) || String(a.authoredUrl).localeCompare(String(b.authoredUrl)));

  for (const row of rows) {
    const tr = document.createElement('tr');
    const [cls, label] = STATUS_META[row.status] || ['', row.status];
    const referrers = [...row.referrers];
    const refText = referrers.slice(0, 4).join(', ') + (referrers.length > 4 ? ` +${referrers.length - 4}` : '') +
      (row.refCount > 1 ? ` (${row.refCount}×)` : '');
    const notes = [...row.notes];
    if (row.dimensions) notes.push(`${row.dimensions.width}×${row.dimensions.height}`);
    const asset = row.projectRelative || row.authoredUrl;

    const cells = [
      ['st ' + cls, label],
      ['mono', asset],
      ['', row.kind],
      ['', refText],
      ['num', humanBytes(row.bytes)],
      ['num', String(row.minDepth)],
      ['note', notes.join('; ')],
    ];
    for (const [c, text] of cells) {
      const td = document.createElement('td');
      if (c) td.className = c;
      td.textContent = text;
      tr.appendChild(td);
    }
    els.assetRows.appendChild(tr);
  }
  els.tableEmpty.style.display = rows.length ? 'none' : 'block';
}

function renderTree(payload) {
  els.tree.innerHTML = '';
  const byReferrer = new Map();
  for (const r of payload.references || []) {
    if (!byReferrer.has(r.referrer)) byReferrer.set(r.referrer, []);
    byReferrer.get(r.referrer).push(r);
  }
  for (const node of payload.wrlNodes || []) {
    const head = document.createElement('div');
    head.className = 'wrl';
    const rel = relTo(payload.root, node.path);
    head.textContent = `▸ ${rel}` + (node.depth ? `  (depth ${node.depth})` : '  (primary)') +
      (node.unreadable ? '  — UNREADABLE' : '');
    els.tree.appendChild(head);

    const refs = byReferrer.get(node.path) || [];
    if (!refs.length) continue;
    const ul = document.createElement('ul');
    for (const r of refs) {
      const li = document.createElement('li');
      const [, label] = STATUS_META[r.status] || ['', r.status];
      const target = r.projectRelative || r.authoredUrl;
      const cycle = (r.warnings || []).includes('dependency cycle');
      li.textContent = `${target} — ${label}` + (r.duplicate ? ' (repeat)' : '');
      if (cycle) li.className = 'cycle';
      ul.appendChild(li);
    }
    els.tree.appendChild(ul);
  }
}

// ---- reset / test hooks ---------------------------------------------------

function resetWorld() {
  current = null;
  showState('empty');
  els.empty.textContent = 'No World Project open. Choose Open Project Folder… or Open Primary WRL…';
  els.refreshBtn.disabled = true;
  els.revealBtn.disabled = true;
  els.editorBtn.disabled = true;
  setStatus('No project open.');
}

// Exposed for the non-interactive visual-QA capture harness (main.js world
// jobs). They render an already-computed scan payload / reset the view; they add
// no new capability or privilege beyond what the read-only IPC already returns.
window.__wrlForgeApplyWorld = applyScan;
window.__wrlForgeResetWorld = resetWorld;

// ---- wire buttons ---------------------------------------------------------

document.getElementById('openFolderBtn').addEventListener('click', async () => {
  handleDetection(await W.openFolder());
});
document.getElementById('openFileBtn').addEventListener('click', async () => {
  handleDetection(await W.openPrimaryFile());
});
els.refreshBtn.addEventListener('click', async () => {
  setStatus('Refreshing…');
  applyScan(await W.refreshProject());
});
els.revealBtn.addEventListener('click', () => { W.revealRoot().catch(() => {}); });
els.editorBtn.addEventListener('click', () => { W.openPrimaryInEditor().catch(() => {}); });
document.getElementById('mallBtn').addEventListener('click', () => window.vrmlpad.goto('mall'));

// On load, restore any already-open project (e.g. after returning from Mall).
(async () => {
  if (!W) return;
  try {
    const desc = await W.describe();
    if (desc && desc.primary) {
      applyScan(await W.scanProject());
    } else if (desc && desc.ambiguous) {
      renderCandidates(desc.candidates);
      showState('ambiguous');
    }
  } catch { /* nothing open */ }
})();
