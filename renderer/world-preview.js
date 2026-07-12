'use strict';
// Embedded X_ITE World Project preview controller (renderer, Phase 4B).
//
// PROFILE SEPARATION: this is the World Project preview, deliberately SEPARATE
// from the Mall Item preview (renderer/preview.js). It applies NO Mall placement
// rules -- no Cybertown Fit, no fit-math, no guides, no bounds compliance, no
// 80KB cap, no texture cap. A world is analysed and displayed as-authored.
//
// Read-only + local-only + asset-graph-authorized:
//   - The decompressed primary text and a wrlworld:// base URL come from the
//     main process (window.vrmlpad.world.loadPreview -- no path supplied here).
//   - X_ITE resolves every nested Inline / texture against wrlworld:// URLs,
//     which route back to the main-process handler; that handler serves ONLY
//     files the production asset graph authorized, confined to the project root,
//     gzip-decompressed. Missing / case-mismatched / remote / unsafe references
//     are NOT served (they surface as runtime load warnings).
//   - Each nested WRL resolves its relative URLs from its OWN directory (the
//     scheme is hierarchical), so per-file base paths are correct.
//
// This preview is analysis + display only. It never marks a project upload-ready,
// never repairs/copies/renames assets, never packages or uploads, never edits.

(function () {
  const W = (window.vrmlpad && window.vrmlpad.world) || null;

  let browser = null;
  let ready = null;
  let meta = null;                 // last payload from loadPreview
  let haveValidScene = false;      // a real scene has rendered at least once
  let viewpointNodes = [];         // live X_ITE viewpoint nodes for the selector
  const runtimeWarnings = [];

  const el = (id) => document.getElementById(id);

  // ---- runtime load-failure capture (missing/relative/remote deps) -----------
  const origError = console.error;
  console.error = function (...a) {
    const msg = a.join(' ');
    if (/(texture|inline|\.wrl|\.png|\.jpg|\.jpeg|\.gif|Failed to (load|fetch)|Couldn't load|could not|404)/i.test(msg)) {
      runtimeWarnings.push(msg.slice(0, 240));
    }
    origError.apply(console, a);
  };

  function setStatus(text, kind) {
    const s = el('wpStatus');
    if (!s) return;
    s.textContent = text;
    s.style.color = kind === 'error' ? '#ff9b9b' : kind === 'warn' ? '#ffce6a' : '#9ab';
  }
  function setStale(on) {
    const b = el('wpStale');
    if (b) b.style.display = on ? 'inline-block' : 'none';
  }

  async function ensureBrowser() {
    if (browser) return browser;
    if (!ready) {
      ready = (async () => {
        await X3D();
        const canvas = el('wpCanvas');
        browser = canvas.browser;
        // Discover viewpoints authored inside nested Inline scenes too.
        try { browser.setBrowserOption('EnableInlineViewpoints', true); } catch { /* older X_ITE */ }
        return browser;
      })();
    }
    return ready;
  }

  // ---- public: (re)load the current world into the preview -------------------
  async function load() {
    if (!W) { setStatus('World preview unavailable (no bridge).', 'error'); return debugState(); }
    await ensureBrowser();
    setStatus('Loading world preview…');
    let payload;
    try {
      payload = await W.loadPreview();
    } catch (err) {
      setStatus('Cannot load preview: ' + (err && err.message || err), 'error');
      return debugState();
    }
    meta = payload;
    runtimeWarnings.length = 0;

    if (payload.status === 'primary-unreadable' || payload.text == null) {
      // Primary can't be read (e.g. corrupt gzip). Keep any last valid scene.
      setStatus('Primary world could not be read: ' + (payload.error || 'unknown') +
        (haveValidScene ? ' — keeping last valid preview.' : ''), 'error');
      setStale(haveValidScene);
      renderMeta();
      return debugState();
    }

    try {
      browser.baseURL = payload.baseURL;
      const scene = await browser.createX3DFromString(payload.text);
      await browser.replaceWorld(scene);
      haveValidScene = true;
      setStale(false);
    } catch (err) {
      // Temporary parse error (e.g. a half-written external save): keep the last
      // valid scene, flag stale, allow a manual Refresh. Do NOT clear the canvas.
      setStatus('Parse error — ' + (haveValidScene ? 'keeping last valid preview.' : 'no scene yet.') +
        ' Fix the world and Refresh. (' + (err && err.message || err) + ')', 'error');
      setStale(haveValidScene);
      renderMeta();
      return debugState();
    }

    // Let nested Inline scenes + textures attempt to load before enumerating.
    await new Promise((r) => setTimeout(r, 500));
    discoverViewpoints();
    setStatus(payload.wasGzipped
      ? 'World preview loaded (primary from gzip). Analysis + display only — not an upload check.'
      : 'World preview loaded. Analysis + display only — not an upload check.');
    renderMeta();
    return debugState();
  }

  // ---- viewpoints ------------------------------------------------------------
  function activeLayer() {
    try { return browser.getActiveLayer(); } catch { return null; }
  }
  function viewpointLabel(vp, i) {
    let desc = '';
    try { desc = (vp.getDescriptions() || []).join(' » '); } catch { /* ignore */ }
    if (desc) return desc;
    let type = 'Viewpoint';
    try { type = vp.getTypeName(); } catch { /* ignore */ }
    return `${type} ${i + 1}`;
  }
  function discoverViewpoints() {
    const sel = el('wpViewpoint');
    viewpointNodes = [];
    const layer = activeLayer();
    try { viewpointNodes = (layer && layer.getUserViewpoints()) || []; } catch { viewpointNodes = []; }
    if (!sel) return;
    sel.innerHTML = '';
    if (!viewpointNodes.length) {
      const o = document.createElement('option');
      o.textContent = '(default view)';
      sel.appendChild(o);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    viewpointNodes.forEach((vp, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = viewpointLabel(vp, i);
      let bound = false;
      try { bound = vp._isBound && vp._isBound.getValue(); } catch { /* ignore */ }
      if (bound) o.selected = true;
      sel.appendChild(o);
    });
  }
  function selectViewpoint(i) {
    const layer = activeLayer();
    const vp = viewpointNodes[i];
    if (!layer || !vp) return;
    try { browser.bindViewpoint(layer, vp); } catch (err) { setStatus('Could not bind viewpoint: ' + (err && err.message || err), 'warn'); }
  }
  function resetView() {
    try {
      const vp = browser.getActiveViewpoint();
      if (vp && typeof vp.resetUserOffsets === 'function') vp.resetUserOffsets();
    } catch { /* ignore */ }
  }

  // ---- navigation mode (optional; feature-detected) --------------------------
  function setNavigation(mode) {
    try {
      const nav = browser.getActiveNavigationInfo();
      if (nav) nav.type = [mode, 'ANY'];
    } catch { /* X_ITE without a settable NavigationInfo -> ignore */ }
  }

  // ---- meta / warnings panel -------------------------------------------------
  function renderMeta() {
    if (!meta) return;
    const c = meta.counts || {};
    const loadedCount = (c.presentAssets || 0);
    const missingCount = (c.missing || 0) + (c.caseMismatches || 0);
    const lm = el('wpLoadedMissing');
    if (lm) lm.textContent = `${loadedCount} local asset(s) loaded · ${missingCount} unavailable (missing/case)`;
    const src = el('wpPrimary');
    if (src) src.textContent = `${meta.primaryRel || '—'} ${meta.wasGzipped ? '(gzip)' : '(plain)'}`;

    const box = el('wpWarnings');
    if (!box) return;
    const items = [];
    if (meta.stale) items.push(`<div class="warn err">Showing the last valid scene (a rescan/refresh did not fully succeed).</div>`);
    if (meta.remoteUrls && meta.remoteUrls.length) {
      items.push(`<div class="warn err">Remote URL(s) blocked (never fetched): ${meta.remoteUrls.map(esc).join(', ')}</div>`);
    }
    if (meta.unsafeRefs && meta.unsafeRefs.length) {
      items.push(`<div class="warn err">Unsafe path(s) refused (absolute / escapes project root): ${meta.unsafeRefs.map(esc).join(', ')}</div>`);
    }
    if (meta.missingAssets && meta.missingAssets.length) {
      items.push(`<div class="warn">Missing local asset(s): ${meta.missingAssets.slice(0, 12).map(esc).join(', ')}${meta.missingAssets.length > 12 ? ` +${meta.missingAssets.length - 12}` : ''}</div>`);
    }
    if (meta.caseMismatches && meta.caseMismatches.length) {
      items.push(`<div class="warn">Case mismatch (breaks on case-sensitive servers): ${meta.caseMismatches.slice(0, 8).map((c) => esc(c.referenced) + ' → ' + esc(c.actual)).join(', ')}</div>`);
    }
    for (const w of [...new Set(runtimeWarnings)].slice(0, 12)) items.push(`<div class="warn">Runtime: ${esc(w)}</div>`);
    box.innerHTML = items.join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function debugState() {
    return {
      status: meta ? meta.status : 'none',
      haveValidScene,
      wasGzipped: meta ? !!meta.wasGzipped : false,
      baseURL: meta ? meta.baseURL : null,
      viewpoints: viewpointNodes.map((vp, i) => viewpointLabel(vp, i)),
      counts: meta ? meta.counts : null,
      remoteUrls: meta ? meta.remoteUrls : [],
      missingAssets: meta ? meta.missingAssets : [],
      runtimeWarnings: [...new Set(runtimeWarnings)],
    };
  }

  // ---- wiring ----------------------------------------------------------------
  function wire() {
    const rf = el('wpRefresh'); if (rf) rf.addEventListener('click', () => load());
    const rv = el('wpReset'); if (rv) rv.addEventListener('click', resetView);
    const vp = el('wpViewpoint'); if (vp) vp.addEventListener('change', (e) => selectViewpoint(Number(e.target.value)));
    const nav = el('wpNav'); if (nav) nav.addEventListener('change', (e) => setNavigation(e.target.value));
  }

  // Public API (used by world.js + the read-only visual-QA capture harness).
  window.wrlWorldPreview = { load, wire, resetView, discoverViewpoints, _debug: debugState };

  // QA hook: load (optionally select a viewpoint / reset) and return debug JSON.
  // Read-only; adds no capability beyond what world:previewLoad already returns.
  window.__wrlForgeWorldPreview = async function (opts) {
    const dbg = await load();
    if (opts && Number.isInteger(opts.viewpoint)) { selectViewpoint(opts.viewpoint); }
    if (opts && opts.reset) { resetView(); }
    return dbg;
  };

  document.addEventListener('DOMContentLoaded', wire);
})();
