'use strict';
// Phase 7C2 + 7C3 -- the in-editor live-preview orchestrator. Thin DOM glue on
// top of pure, unit-tested pieces:
//   * window.WrlPreviewState     -- the last-valid-scene state machine (7C1)
//   * window.WrlPreviewScheduler -- the 700 ms debounce / coalescing model (7C1)
//   * window.WrlEditorUI         -- pure layout + status view-models (ui-state.js)
//   * window.wrlPreview          -- the REUSED Mall X_ITE render + fit engine
//                                   (preview.js), driven with an injected source
//   * window.wrlWorldPreview     -- the REUSED World X_ITE render engine
//                                   (world-preview.js), same injected-source
//                                   pattern, plus opt-in viewpoint preservation
//   * window.vrmlpad.editor      -- the confined main-process preview bridge
//
// The profile comes from the OPEN document's context ('mall' | 'world'); the
// matching engine renders, and the profile-specific controls show. The renderer
// NEVER supplies a filesystem path: it sends only { sessionId, text,
// bufferVersion }. Main authorizes the session against its own authority (the
// held Mall source, or the World scan graph), byte-substitutes the unsaved
// buffer through the overlay, and returns the payload. One render runs at a
// time (serial in-flight), so completions can never land out of order; the
// overlay's generation check is the belt-and-suspenders authority.

(function () {
  const PS = window.WrlPreviewState;
  const SCHED = window.WrlPreviewScheduler;
  const UI = window.WrlEditorUI;
  const bridge = window.vrmlpad.editor;

  const el = (id) => document.getElementById(id);
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  function byteLen(text) {
    return encoder ? encoder.encode(text).length : unescape(encodeURIComponent(text)).length;
  }

  // Phase: Preferences & Settings -- the preview LAYOUT is now a shared
  // preferences value (window.WrlPreferences). The split fraction remains a
  // local cosmetic detail of the divider (not a global user preference), so
  // it keeps its own localStorage key. Layout edits from the Preferences
  // dialog reach this orchestrator through the shared model -- the
  // orchestrator's own applyLayout() is the single live applier.
  const LAYOUT_KEY = 'wrlforge.editor.previewLayout';
  const SPLIT_KEY = 'wrlforge.editor.previewSplit';
  function savedLayout() {
    if (window.WrlPreferences) {
      return UI.resolvePreviewLayout(window.WrlPreferences.get('previewLayout'));
    }
    try { return UI.resolvePreviewLayout(window.localStorage.getItem(LAYOUT_KEY)); }
    catch (e) { return UI.PREVIEW_LAYOUT_DEFAULT; }
  }
  function savedSplit() {
    try { return UI.clampSplit(window.localStorage.getItem(SPLIT_KEY)); }
    catch (e) { return UI.SPLIT_DEFAULT; }
  }
  function persistLayout(l) {
    if (window.WrlPreferences) window.WrlPreferences.set('previewLayout', l);
    else try { window.localStorage.setItem(LAYOUT_KEY, l); } catch (e) { /* best-effort */ }
  }
  function persistSplit(f) { try { window.localStorage.setItem(SPLIT_KEY, String(f)); } catch (e) { /* best-effort */ } }

  // --- orchestrator state ----------------------------------------------------
  const St = {
    active: false,
    sessionId: null,
    context: 'mall',        // the open document's profile: 'mall' | 'world'
    getText: () => '',
    getVersion: () => 0,
    sm: PS.createPreviewState(),
    scheduler: SCHED.createPreviewScheduler({ debounceMs: 700 }),
    timer: null,
    inFlight: false,
    displaySaved: false,
    sizeTier: 'auto',       // last known size band, for the status chip
    newRefs: 0,             // buffer references not yet in the World graph
    lastRenderMs: null,     // last scene-replacement duration (QA/perf evidence)
    layout: 'split',
    split: 0.5,
  };

  function nowMs() { return Date.now(); }

  // The render engine for the open document's profile. Both are the REUSED
  // page-scope controllers (never forked); only one is ever driven per document.
  function engine() {
    return St.context === 'world' ? window.wrlWorldPreview : window.wrlPreview;
  }

  // --- status chip -----------------------------------------------------------
  function paintChip() {
    const chip = el('previewChip');
    if (!chip) return;
    const model = UI.previewStatusModel({
      state: St.sm.state,
      failureCategory: St.sm.failureCategory,
      saved: St.displaySaved,
      sizeTier: St.sizeTier,
      newRefs: St.newRefs,
    });
    chip.textContent = model.label;
    chip.className = 'preview-chip tone-' + model.tone;
    chip.setAttribute('data-state', model.key);
  }

  // --- layout ----------------------------------------------------------------
  function applyLayout() {
    const m = UI.previewLayoutModel(St.layout, St.split);
    St.layout = m.layout; St.split = m.split;
    const main = el('editorMain');
    if (main) {
      main.classList.toggle('layout-split', m.layout === 'split');
      main.classList.toggle('layout-preview-max', m.layout === 'preview-max');
      main.classList.toggle('layout-editor-only', m.layout === 'editor-only');
      main.style.setProperty('--wrl-split', String(m.split));
    }
    const divider = el('previewDivider');
    if (divider) {
      divider.setAttribute('aria-valuenow', String(m.splitPercent));
      divider.style.display = m.layout === 'split' ? '' : 'none';
    }
    const maxBtn = el('previewMaxBtn');
    if (maxBtn) {
      maxBtn.textContent = m.maximized ? 'Restore' : 'Maximize';
      maxBtn.setAttribute('aria-pressed', String(m.maximized));
    }
    const sel = el('previewLayoutSelect');
    if (sel && sel.value !== m.layout) sel.value = m.layout;
    persistLayout(m.layout); persistSplit(m.split);
    // Entering a layout that shows the preview for the first time: render it.
    if (m.previewVisible && St.active && St.sm.displayedGeneration === 0 && !St.inFlight) {
      requestUpdate('manual');
    }
  }

  function setLayout(mode) { St.layout = UI.resolvePreviewLayout(mode); applyLayout(); }
  function toggleMaximize() { St.layout = UI.togglePreviewMaximize(St.layout); applyLayout(); }
  function stepSplit(delta) { St.split = UI.splitStep(St.split, delta); applyLayout(); }

  // --- divider (mouse + keyboard) -------------------------------------------
  function wireDivider() {
    const divider = el('previewDivider');
    const main = el('editorMain');
    if (!divider || !main) return;
    let dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const rect = main.getBoundingClientRect();
      if (rect.width <= 0) return;
      const frac = (e.clientX - rect.left) / rect.width;
      St.split = UI.clampSplit(frac);
      main.style.setProperty('--wrl-split', String(St.split));
      const pct = Math.round(St.split * 100);
      divider.setAttribute('aria-valuenow', String(pct));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persistSplit(St.split);
    };
    divider.addEventListener('mousedown', (e) => {
      if (St.layout !== 'split') return;
      dragging = true; e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    divider.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { stepSplit(-0.05); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { stepSplit(+0.05); e.preventDefault(); }
      else if (e.key === 'Home') { St.split = UI.SPLIT_MIN; applyLayout(); e.preventDefault(); }
      else if (e.key === 'End') { St.split = UI.SPLIT_MAX; applyLayout(); e.preventDefault(); }
    });
    // Register the div listeners for deterministic teardown.
    St._dividerCleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }

  // --- the auto/manual update pipeline --------------------------------------
  function armTimer(dueAt) {
    if (St.timer) { clearTimeout(St.timer); St.timer = null; }
    St.timer = setTimeout(pump, Math.max(0, dueAt - nowMs()));
  }

  function pump() {
    St.timer = null;
    if (!St.active) return;
    const p = St.scheduler.poll(St.sessionId, nowMs());
    if (!p.fire) { if (p.dueAt != null) armTimer(p.dueAt); return; }
    fire(p.kind);
  }

  // The editor buffer changed: bump to Outdated, then either schedule a debounced
  // auto-refresh (<=1 MiB) or fall to manual-only (>1 MiB) with plain wording.
  function onEdit() {
    if (!St.active) return;
    St.displaySaved = false;
    const version = St.getVersion();
    const bytes = byteLen(St.getText());
    St.sm = PS.edit(St.sm, version);
    const r = St.scheduler.requestAuto(St.sessionId, { bufferVersion: version, byteLength: bytes, at: nowMs() });
    if (!r.scheduled) {
      // Over the auto threshold: manual Update only.
      St.sizeTier = 'manual';
      paintChip();
      return;
    }
    St.sizeTier = 'auto';
    armTimer(r.dueAt);
    paintChip();
  }

  // Manual Update (button / Ctrl+Enter): bypass the debounce entirely.
  function manualUpdate() {
    if (!St.active) return;
    St.displaySaved = false;
    const version = St.getVersion();
    St.scheduler.requestManual(St.sessionId, { bufferVersion: version, at: nowMs() });
    if (St.timer) { clearTimeout(St.timer); St.timer = null; }
    pump();
  }

  // Explicitly ask for one render now (used when a hidden preview is first shown).
  function requestUpdate(kind) {
    if (kind === 'manual') manualUpdate(); else onEdit();
  }

  async function fire() {
    if (!St.active || St.inFlight) return;
    St.inFlight = true;
    const version = St.getVersion();
    const text = St.getText();
    let res;
    try {
      res = await bridge.previewLoad(St.sessionId, text, version);
    } catch (e) {
      St.inFlight = false;
      St.sm = PS.fail(St.sm, St.sm.requestedGeneration, 'parser');
      paintChip();
      return afterFire();
    }
    if (!res || !res.ok) {
      St.inFlight = false;
      handleRefusal(res);
      return afterFire();
    }
    const gen = res.generation;
    St.sizeTier = res.sizeTier || 'auto';
    St.newRefs = res.buffer && Array.isArray(res.buffer.newRefs) ? res.buffer.newRefs.length : 0;
    paintWorldIdentity(res);
    St.sm = PS.beginUpdate(St.sm, gen, res.bufferVersion);
    paintChip(); // "Updating…"

    let result;
    const t0 = nowMs();
    try {
      // A NESTED World edit is pre-validated through X_ITE (never the parser)
      // BEFORE the world is replaced: X_ITE treats a failed Inline as an async
      // warning, so skipping this would swap in a full scene with the edited
      // piece silently missing instead of keeping the last good version.
      if (St.context === 'world' && res.editedIsPrimary === false && typeof res.editedText === 'string') {
        const v = await window.wrlWorldPreview.validateText(res.editedText);
        if (!v.ok) throw new Error(v.error || 'nested text rejected');
      }
      // World refreshes preserve the user's viewpoint/navigation where possible.
      result = await engine().load({ source: async () => res, preserveView: St.context === 'world' });
    } catch (e) {
      result = { ok: false, parseError: String((e && e.message) || e) };
    }
    St.lastRenderMs = nowMs() - t0;
    // Confirm the generation with main (older/replayed generations are refused
    // there); our serial pipeline means this is always the in-flight one.
    try { await bridge.previewAccept(St.sessionId, gen); } catch (e) { /* best-effort */ }

    if (result && result.ok) {
      St.sm = PS.succeed(St.sm, gen, res.bufferVersion, 'buffer');
      St.displaySaved = false;
    } else if (result && result.parseError) {
      // X_ITE could not parse the newest text -- preview.js kept the last valid
      // scene on screen. Surface "showing last good version" (or "can't display").
      St.sm = PS.fail(St.sm, gen, 'scene-load');
    } else {
      St.sm = PS.fail(St.sm, gen, 'scene-load');
    }
    paintChip();
    St.inFlight = false;
    afterFire();
  }

  // After a render settles, honour any newer coalesced edit.
  function afterFire() {
    if (!St.active) return;
    const pend = St.scheduler.pendingFor(St.sessionId);
    if (!pend) return;
    const now = nowMs();
    if (now >= pend.dueAt) pump(); else armTimer(pend.dueAt);
  }

  function handleRefusal(res) {
    const reason = res && res.reason;
    if (reason === 'too-large') {
      St.sizeTier = 'refused';
      // Leave any existing scene up; the chip explains the save-then-open path.
      paintChip();
      return;
    }
    // Authorization / session problems: keep last valid, show a soft failure.
    St.sm = PS.fail(St.sm, St.sm.requestedGeneration, 'scene-load');
    paintChip();
  }

  // "Show saved version": render the on-disk source, not the buffer. For a World
  // document this renders the FULL world entirely from disk (main skips the
  // overlay for this render); the unsaved buffer and dirty state are untouched,
  // and a later Update returns to the unsaved version.
  async function showSaved() {
    if (!St.active) return;
    let res;
    try { res = await bridge.previewSaved(St.sessionId); }
    catch (e) { return; }
    if (!res || !res.ok) return;
    paintWorldIdentity(res);
    try {
      await engine().load({ source: async () => res });
      St.displaySaved = true;
      paintChip();
    } catch (e) { /* the engine kept the last valid scene */ }
  }

  // Identify what the World pane is showing: always the FULL project, and which
  // document inside it is being edited. Mall documents leave the line untouched.
  function paintWorldIdentity(res) {
    if (St.context !== 'world' || !res) return;
    const line = el('epEditedLine');
    if (!line) return;
    if (res.primaryRel) {
      line.textContent = res.editedIsPrimary || !res.editedRel
        ? `Full World Project preview — primary: ${res.primaryRel}`
        : `Full World Project preview — primary: ${res.primaryRel} · editing: ${res.editedRel}`;
    }
  }

  // Explicit "Find new files" (World only): main reruns its own project scan --
  // no path crosses IPC -- then a fresh Update renders against the new graph.
  async function findNewFiles() {
    if (!St.active || St.context !== 'world') return;
    const btn = el('previewFindNewBtn');
    if (btn) btn.disabled = true;
    let res = null;
    try { res = await bridge.previewRescan(St.sessionId); } catch (e) { res = null; }
    if (btn) btn.disabled = false;
    if (res && res.ok) manualUpdate();
  }

  // --- lifecycle -------------------------------------------------------------
  // Called by editor.js once the editor has an open Mall or World document.
  // Idempotent per session; a different session first tears down the previous
  // one (its overlay, timer, and scene can never leak into this document).
  function start({ sessionId, getText, getVersion, context } = {}) {
    if (St.active && St.sessionId === sessionId) return;
    if (St.active) stop();
    St.active = true;
    St.sessionId = sessionId;
    St.context = context === 'world' ? 'world' : 'mall';
    St.getText = typeof getText === 'function' ? getText : (() => '');
    St.getVersion = typeof getVersion === 'function' ? getVersion : (() => 0);
    St.sm = PS.createPreviewState();
    St.scheduler.cancel(sessionId);
    St.inFlight = false;
    St.displaySaved = false;
    St.sizeTier = 'auto';
    St.newRefs = 0;
    St.lastRenderMs = null;
    applyProfileBody();
    paintChip();
    // Render the initial buffer immediately (unless the preview pane is hidden).
    const m = UI.previewLayoutModel(St.layout, St.split);
    if (m.previewVisible) requestUpdate('manual');
  }

  // Show only the open profile's preview body (Mall: fit modes/guides/report;
  // World: viewpoints/navigation/Find new files). The inactive body is hidden
  // and its X_ITE canvas never receives a scene.
  function applyProfileBody() {
    const col = document.querySelector('.preview-col');
    if (!col) return;
    col.classList.toggle('context-world', St.context === 'world');
    col.classList.toggle('context-mall', St.context !== 'world');
  }

  // Tear down: stop timers, forget the scene, tell main to drop the overlay.
  function stop() {
    if (St.timer) { clearTimeout(St.timer); St.timer = null; }
    if (St._dividerCleanup) St._dividerCleanup();
    const sid = St.sessionId;
    if (sid != null) {
      St.scheduler.cancel(sid);
      try { bridge.previewClose(sid); } catch (e) { /* best-effort */ }
    }
    St.active = false;
    St.inFlight = false;
    St.sm = PS.close(St.sm);
    St.displaySaved = false;
  }

  // --- wiring ----------------------------------------------------------------
  function wire() {
    St.layout = savedLayout();
    St.split = savedSplit();
    wireDivider();
    applyLayout();
    paintChip();

    const upd = el('previewUpdateBtn');
    if (upd) upd.addEventListener('click', () => manualUpdate());
    const mx = el('previewMaxBtn');
    if (mx) mx.addEventListener('click', () => toggleMaximize());
    const sv = el('previewSavedBtn');
    if (sv) sv.addEventListener('click', () => showSaved());
    const fn = el('previewFindNewBtn');
    if (fn) fn.addEventListener('click', () => findNewFiles());
    const sel = el('previewLayoutSelect');
    if (sel) sel.addEventListener('change', () => setLayout(sel.value));

    // Tell main to drop the overlay if the renderer is torn down (reload / close /
    // navigate). This is the renderer-reload cleanup path.
    window.addEventListener('beforeunload', () => {
      if (St.sessionId != null) { try { bridge.previewClose(St.sessionId); } catch (e) { /* ignore */ } }
    });
  }

  // Public surface for editor.js + the serialized QA harness. No capability beyond
  // what the page already does through its own controls.
  window.wrlEditorPreview = {
    start, stop, onEdit, manualUpdate, showSaved, findNewFiles,
    setLayout, toggleMaximize, stepSplit,
    // QA / introspection (no buffer text exposed).
    _state: () => ({
      state: St.sm.state, failureCategory: St.sm.failureCategory,
      displayedGeneration: St.sm.displayedGeneration, requestedGeneration: St.sm.requestedGeneration,
      haveLastValid: St.sm.haveLastValid, saved: St.displaySaved, sizeTier: St.sizeTier,
      context: St.context, newRefs: St.newRefs, lastRenderMs: St.lastRenderMs,
      layout: St.layout, split: St.split, chip: (el('previewChip') || {}).textContent,
      world: (St.context === 'world' && window.wrlWorldPreview) ? window.wrlWorldPreview._debug() : null,
    }),
    _leak: () => bridge.previewLeak(),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
