'use strict';
// World Project packaging controller (renderer, Phase 5A). Read-only analysis +
// one explicit action:
//   * "Package Audit"        — asks the main process what a portable review bundle
//                              would contain (status / totals / blocking / unused /
//                              manifest preview). Nothing is written.
//   * "Build Review Bundle…" — the ONE explicit user action: the main process
//                              prompts for a destination OUTSIDE the project and
//                              writes a deterministic ZIP. It is NOT an upload and
//                              claims no current-server compatibility.
//
// It has no filesystem access of its own — every path and the manifest come back
// from the confined main-process handlers. It never applies Mall Item rules.

const WP = (window.vrmlpad && window.vrmlpad.world) || null;

const el = {
  auditBtn: document.getElementById('pkgAuditBtn'),
  buildBtn: document.getElementById('pkgBuildBtn'),
  status: document.getElementById('pkgStatus'),
  badge: document.getElementById('pkgStatusBadge'),
  body: document.getElementById('pkgBody'),
  totals: document.getElementById('pkgTotals'),
  blocking: document.getElementById('pkgBlocking'),
  output: document.getElementById('pkgOutput'),
  unused: document.getElementById('pkgUnused'),
  manifest: document.getElementById('pkgManifest'),
};

let lastAudit = null;

function humanBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const STATUS_LABEL = {
  'ready': ['ready', 'READY'],
  'blocked': ['blocked', 'BLOCKED'],
  'needs-review': ['needsreview', 'NEEDS REVIEW'],
};

function statBox(label, value) {
  const d = document.createElement('div');
  d.className = 'stat';
  d.innerHTML = '<div class="n"></div><div class="l"></div>';
  d.querySelector('.n').textContent = value;
  d.querySelector('.l').textContent = label;
  return d;
}

function render(audit) {
  lastAudit = audit;
  if (!audit) return;
  el.body.style.display = 'block';

  const [cls, text] = STATUS_LABEL[audit.status] || ['', String(audit.status || '').toUpperCase()];
  el.badge.style.display = 'inline-block';
  el.badge.className = 'badge-pill ' + cls;
  el.badge.textContent = text;

  // Totals
  el.totals.innerHTML = '';
  el.totals.appendChild(statBox('Files', audit.totals.totalFiles));
  el.totals.appendChild(statBox('Total size', humanBytes(audit.totals.totalBytes)));
  el.totals.appendChild(statBox('WRL files', audit.totals.wrlCount));
  el.totals.appendChild(statBox('Unique textures', audit.totals.uniqueTextureCount));
  el.totals.appendChild(statBox('Unused', audit.unusedFiles.length));

  // Blocking findings
  el.blocking.innerHTML = '';
  if (audit.blocking && audit.blocking.length) {
    for (const b of audit.blocking) {
      const d = document.createElement('div');
      d.className = 'finding error';
      d.innerHTML = '<span class="sev">BLOCKING</span><span class="msg"></span>';
      d.querySelector('.msg').textContent = b.message;
      el.blocking.appendChild(d);
    }
  }

  // Unused files
  el.unused.innerHTML = '';
  if (audit.unusedFiles.length) {
    for (const u of audit.unusedFiles) {
      const d = document.createElement('div');
      d.textContent = u.relPath;
      el.unused.appendChild(d);
    }
  } else {
    const d = document.createElement('div');
    d.className = 'none';
    d.textContent = 'None — every file under the project root is referenced.';
    el.unused.appendChild(d);
  }

  // Manifest preview (pretty JSON)
  try {
    el.manifest.textContent = JSON.stringify(audit.manifest, null, 2);
  } catch {
    el.manifest.textContent = '(manifest unavailable)';
  }

  // Build button is enabled only when nothing blocks packaging.
  const blocked = audit.status === 'blocked';
  el.buildBtn.disabled = blocked;
  el.buildBtn.title = blocked ? 'Resolve the blocking findings before building a bundle.' : '';

  const parts = [`Status: ${text}`,
    `${audit.totals.totalFiles} file(s), ${humanBytes(audit.totals.totalBytes)}`,
    `${audit.totals.uniqueTextureCount} unique texture(s)`];
  if (audit.unusedFiles.length) parts.push(`${audit.unusedFiles.length} unused file(s) reported (not included)`);
  el.status.textContent = parts.join(' · ');
}

function showOutput(res) {
  el.output.style.display = 'block';
  if (res && res.ok && res.outPath) {
    el.output.className = 'pkg-output';
    el.output.textContent =
      `Review Bundle written: ${res.outPath}  (${res.entryCount} entries, ${humanBytes(res.bytes)}). ` +
      'Not confirmed for direct Cybertown upload — review it before submitting.';
  } else if (res && res.code === 'EBLOCKED') {
    el.output.className = 'pkg-output err';
    el.output.textContent = 'Blocked: resolve the blocking findings before building a bundle.';
  } else {
    el.output.className = 'pkg-output err';
    el.output.textContent = 'Bundle not written: ' + ((res && res.error) || 'unknown error') + '.';
  }
}

async function runAudit() {
  if (!WP) return;
  el.status.textContent = 'Auditing…';
  el.output.style.display = 'none';
  try {
    render(await WP.packageAudit());
  } catch (err) {
    el.status.textContent = 'Audit failed: ' + String((err && err.message) || err);
  }
}

async function buildBundle() {
  if (!WP) return;
  el.status.textContent = 'Choose a destination outside the project…';
  try {
    const res = await WP.buildReviewBundle();
    if (res === null) { el.status.textContent = 'Bundle canceled.'; return; }
    showOutput(res);
    // Re-audit so totals/unused reflect the current state after a build.
    if (res.ok) el.status.textContent = 'Review Bundle written.';
    else el.status.textContent = res.code === 'EBLOCKED' ? 'Blocked — nothing written.' : 'Bundle not written.';
  } catch (err) {
    showOutput({ ok: false, error: String((err && err.message) || err) });
  }
}

// Called by world.js whenever a project scan is applied: enable the audit action
// and reset stale output. A blocked audit disables the build button on render.
function setEnabled(on) {
  el.auditBtn.disabled = !on;
  if (!on) {
    el.buildBtn.disabled = true;
    el.body.style.display = 'none';
    el.badge.style.display = 'none';
    el.output.style.display = 'none';
    el.status.textContent = 'No audit run.';
    lastAudit = null;
  }
}

el.auditBtn.addEventListener('click', runAudit);
el.buildBtn.addEventListener('click', buildBundle);

// Public + QA hooks. The QA hooks render an already-computed audit / bundle result
// (driven by the capture server) so the visual harness needs no dialog.
window.wrlWorldPackaging = { runAudit, buildBundle, setEnabled, render };
window.__wrlForgeApplyPackageAudit = render;
window.__wrlForgeApplyBundleResult = showOutput;
