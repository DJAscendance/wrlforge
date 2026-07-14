'use strict';
// Embedded X_ITE preview controller for the Mall Item lane (Phase 2B1).
//
// Responsibilities:
//   - Load the current item's DECOMPRESSED text from the main process
//     (window.vrmlpad.loadPreview -- read-only; gzip handled in main.js, so
//     X_ITE only ever receives plain text and never fetches gzip bytes).
//   - Render Original (authored transforms) or Cybertown Fit (a PREVIEW-ONLY
//     parent Transform computed from the authoritative transform-aware bounds,
//     plus non-exported guides). Neither mode ever writes to any file.
//   - Compute authoritative world-space bounds via the shared scene-graph
//     traversal (src/preview/bbox-traversal.js) and the shared fit math
//     (src/preview/fit-math.js), then present scale/offset/bounds/rules and an
//     honest confidence (exact | conservative | unavailable).
//
// The proposed fit is REPORTED and shown as an overlay; it is never applied to
// the loaded VRML text, the .edit.wrl, the source .wrl, or the repacked artifact.

(function () {
  const RULE_LABELS = {
    ground: 'Lowest point rests at Y = -1.75',
    center: 'Centered at X = 0',
    zlimit: 'Max Z within +1',
    size: 'Total size within 10 x 10 x 10',
  };

  let browser = null;
  let ready = null;              // Promise resolving once X3D() has initialised
  let meta = null;               // last loaded { text, baseURL, wasGzipped, remoteUrls, sourcePath }
  let fit = null;                // last computed fit (from authoritative bbox)
  let bbox = null;               // last authoritative bbox
  let lastGoodText = null;       // retained so a temporary parse error keeps the scene
  let mode = 'original';
  const textureWarnings = [];

  const el = (id) => document.getElementById(id);

  // ---- texture-load failure capture -------------------------------------
  // Surface missing/relative/case-mismatch texture failures as warnings rather
  // than silent gaps. Bounds do not depend on textures, so they still succeed.
  const origError = console.error;
  console.error = function (...a) {
    const msg = a.join(' ');
    if (/(texture|\.png|\.jpg|\.jpeg|\.gif|Failed to (load|fetch)|Couldn't load|could not)/i.test(msg)) {
      textureWarnings.push(msg.slice(0, 240));
    }
    origError.apply(console, a);
  };

  function fmt(n) {
    if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
    return (Math.abs(n) < 1e-9 ? 0 : n).toFixed(3);
  }
  function fmtVec(v) { return v.map(fmt).join(', '); }
  function pct(r) { return Number.isFinite(r) ? Math.round(r * 100) + '%' : 'unbounded'; }

  async function ensureBrowser() {
    if (browser) return browser;
    if (!ready) {
      ready = (async () => {
        await X3D();
        const canvas = el('preview');
        browser = canvas.browser;
        return browser;
      })();
    }
    return ready;
  }

  function currentGuideOpts() {
    const opts = { ground: false, center: false, zlimit: false, cage: false, itemBox: false };
    document.querySelectorAll('input.guide').forEach((c) => { opts[c.value] = c.checked; });
    if (opts.itemBox && fit) opts.itemBBox = { min: fit.proposed.min, max: fit.proposed.max };
    return opts;
  }

  function stripHeader(text) {
    return text.replace(/^﻿?\s*#VRML\s+V2\.0\s+utf8[^\n]*\n?/i, '');
  }

  // Preview-only parent transform: scale S then translation offset reproduces
  // fit-math's proposed world bounds (world = S*local + offset, no rotation).
  function fitPreviewVrml() {
    const S = fit.proposedAppliedScale;
    const o = fit.offset;
    const guides = stripHeader(window.buildGuidesVrml(fit.rules, currentGuideOpts()));
    const body = stripHeader(meta.text);
    return `#VRML V2.0 utf8
${guides}
Transform {
  scale ${S} ${S} ${S}
  translation ${o.x} ${o.y} ${o.z}
  children [
${body}
  ]
}
`;
  }

  async function renderScene(text) {
    browser.baseURL = meta.baseURL;
    const scene = await browser.createX3DFromString(text);
    await browser.replaceWorld(scene);
    return scene;
  }

  // Render the geometry for the active mode. Original for bbox computation is
  // always loaded first (bbox reflects authored transforms, not the preview
  // overlay); Fit mode then layers the preview transform + guides.
  async function renderForMode() {
    if (mode === 'fit' && fit) {
      await renderScene(fitPreviewVrml());
    } else {
      await renderScene(meta.text);
    }
  }

  function setStatus(text, isError) {
    const s = el('previewStatus');
    s.textContent = text;
    s.style.color = isError ? '#ff9b9b' : '#9ab';
  }

  // The default source: the Mall workspace's read-only disk loader. The editor
  // live-preview lane (Phase 7C2) passes its own `source` returning the authorized
  // UNSAVED-buffer payload -- same {text, baseURL, sourcePath, remoteUrls} shape,
  // so the render/fit/report path below is reused verbatim, never forked.
  const defaultSource = () => window.vrmlpad.loadPreview('edit');

  // ---- public: (re)load the current source into the preview --------------
  // Returns a small status object so an orchestrator (the editor lane) can drive
  // its own state machine: { ok:true } | { ok:false, parseError } | { ok:false, error }.
  async function load(opts = {}) {
    const source = (opts && opts.source) || defaultSource;
    await ensureBrowser();
    setStatus('Loading preview…');
    let loaded;
    try {
      loaded = await source();
    } catch (err) {
      setStatus('No file to preview: ' + (err && err.message || err), true);
      return { ok: false, error: String((err && err.message) || err) };
    }

    textureWarnings.length = 0;
    let originalScene;
    try {
      meta = loaded;
      browser.baseURL = meta.baseURL;
      originalScene = await browser.createX3DFromString(meta.text);
      await browser.replaceWorld(originalScene);
      lastGoodText = meta.text;
    } catch (err) {
      // Temporary parse error (e.g. a half-written save): keep the last valid
      // scene, warn, and allow a manual retry. Do NOT clear the canvas.
      setStatus('Parse error — keeping last valid preview. Fix the file and Refresh. (' + (err && err.message || err) + ')', true);
      renderReport({ parseError: String(err && err.message || err) });
      return { ok: false, parseError: String((err && err.message) || err) };
    }

    // Give relative textures a moment to attempt loading before snapshotting.
    await new Promise((r) => setTimeout(r, 400));

    try {
      bbox = window.computeSceneBBox(originalScene);
      fit = bbox ? window.computeFit(bbox) : null;
    } catch (err) {
      bbox = null; fit = null;
      textureWarnings.push('Bounds computation failed: ' + (err && err.message || err));
    }

    if (mode === 'fit') {
      try { await renderForMode(); } catch (e) { /* fall back to original already shown */ }
    }

    setStatus(meta.wasGzipped ? 'Preview loaded (from gzip source).' : 'Preview loaded.');
    renderReport({});
    return { ok: true, textureWarnings: dedupe(textureWarnings).length };
  }

  async function switchMode(next) {
    mode = next;
    el('guideControls').disabled = (mode !== 'fit');
    if (!meta) return;
    setStatus(mode === 'fit' ? 'Rendering Cybertown Fit…' : 'Rendering Original…');
    try {
      await renderForMode();
      setStatus(mode === 'fit' ? 'Cybertown Fit preview (overlay only).' : 'Original preview.');
    } catch (err) {
      setStatus('Render error: ' + (err && err.message || err), true);
    }
  }

  async function refreshGuides() {
    if (mode === 'fit' && meta && fit) {
      try { await renderForMode(); } catch (e) { /* ignore */ }
    }
  }

  // ---- report rendering --------------------------------------------------
  function confidenceOf() {
    if (!bbox) return { key: 'unavailable', label: 'bounds unavailable' };
    if (bbox.confidence === 'conservative') return { key: 'conservative', label: 'conservative (overestimate)' };
    return { key: 'exact', label: 'exact' };
  }

  function renderReport(extra) {
    const conf = confidenceOf();
    const pill = el('confidencePill');
    pill.textContent = conf.label;
    pill.className = 'badge-pill conf-' + conf.key;

    if (fit) {
      el('reqScale').textContent = pct(fit.requestedScale);
      el('maxScale').textContent = pct(fit.maxCompliantScale);
      const prop = el('propScale');
      prop.textContent = pct(fit.proposedAppliedScale);
      const reduced = fit.proposedAppliedScale < fit.requestedScale - 1e-9;
      prop.className = 'num scale-proposed' + (reduced ? ' scale-reduced' : '');
      prop.title = reduced ? 'Requested scale reduced to stay within the 10m limit' : '';
      el('offsets').textContent = `${fmt(fit.offset.x)} / ${fmt(fit.offset.y)} / ${fmt(fit.offset.z)}`;

      const o = fit.original, p = fit.proposed;
      el('boundsBody').innerHTML = [
        boundsRow('orig X', o.min[0], o.max[0], o.dims[0]),
        boundsRow('orig Y', o.min[1], o.max[1], o.dims[1]),
        boundsRow('orig Z', o.min[2], o.max[2], o.dims[2]),
        boundsRow('fit X', p.min[0], p.max[0], p.dims[0]),
        boundsRow('fit Y', p.min[1], p.max[1], p.dims[1]),
        boundsRow('fit Z', p.min[2], p.max[2], p.dims[2]),
      ].join('');
      el('centerLine').textContent = `original center: ${fmtVec(o.center)}`;

      renderRules(fit);
    } else {
      el('reqScale').textContent = el('maxScale').textContent = el('propScale').textContent = '—';
      el('offsets').textContent = '—';
      el('boundsBody').innerHTML = '<tr><td colspan="4" class="hint">Authoritative bounds unavailable — cannot mark this item compliant.</td></tr>';
      el('centerLine').textContent = '';
      el('rules').innerHTML = '<div class="check fail soft"><span class="badge">UNKNOWN</span><span>Bounds unavailable; fit rules not evaluated.</span></div>';
    }

    renderWarnings(extra);
  }

  function boundsRow(label, mn, mx, size) {
    return `<tr><th>${label}</th><td class="num">${fmt(mn)}</td><td class="num">${fmt(mx)}</td><td class="num">${fmt(size)}</td></tr>`;
  }

  function renderRules(fit) {
    // Derive per-rule pass/fail from the violation list (a rule passes when the
    // ORIGINAL item does not violate it). Text does not rely on colour alone --
    // each row carries an explicit PASS / FAIL word.
    const violated = {
      ground: fit.violations.some((v) => v.includes('ground')),
      center: fit.violations.some((v) => v.includes('center X')),
      zlimit: fit.violations.some((v) => v.includes('max Z')),
      size: fit.violations.some((v) => v.includes('dimensions')),
    };
    el('rules').innerHTML = Object.keys(RULE_LABELS).map((k) => {
      const pass = !violated[k];
      const cls = pass ? 'pass' : 'fail soft';
      const word = pass ? 'PASS' : 'NEEDS FIT';
      return `<div class="check ${cls}"><span class="badge">${word}</span><span>${RULE_LABELS[k]}</span></div>`;
    }).join('');
  }

  function renderWarnings(extra) {
    const box = el('previewWarnings');
    const items = [];
    if (extra && extra.parseError) {
      items.push(`<div class="warn err">Parse error (showing last valid preview): ${escapeHtml(extra.parseError)}</div>`);
    }
    if (meta && meta.remoteUrls && meta.remoteUrls.length) {
      items.push(`<div class="warn err">Remote URL(s) blocked (never fetched): ${meta.remoteUrls.map(escapeHtml).join(', ')}</div>`);
    }
    if (bbox && bbox.warnings) {
      for (const w of bbox.warnings) items.push(`<div class="warn">${escapeHtml(w)}</div>`);
    }
    for (const w of dedupe(textureWarnings)) items.push(`<div class="warn">Texture: ${escapeHtml(w)}</div>`);
    box.innerHTML = items.join('');
  }

  function dedupe(a) { return [...new Set(a)]; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---- wire controls -----------------------------------------------------
  function wire() {
    const mo = el('modeOriginal'); if (mo) mo.addEventListener('change', () => switchMode('original'));
    const mf = el('modeFit'); if (mf) mf.addEventListener('change', () => switchMode('fit'));
    document.querySelectorAll('input.guide').forEach((c) => c.addEventListener('change', refreshGuides));
    // The Mall workspace has its own Refresh button; the editor lane drives load()
    // through its own Update control, so this binding is optional.
    const rb = el('refreshBtn'); if (rb) rb.addEventListener('click', () => load());
  }

  window.wrlPreview = {
    load,
    wire,
    // Report whether a scene is currently displayed (used by the editor lane to
    // know a last-valid scene exists without reaching into internals).
    hasScene: () => lastGoodText != null,
    currentMode: () => mode,
    // exposed for the electron preview harness (test only)
    _debug: () => ({ bbox, fit, remoteUrls: meta && meta.remoteUrls, textureWarnings: dedupe(textureWarnings) }),
  };

  document.addEventListener('DOMContentLoaded', wire);
})();
