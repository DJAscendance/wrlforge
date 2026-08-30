'use strict';
// Phase Beta 2 -- Recovery prompt. A single, DOM-only module that:
//   * runs at page load,
//   * asks the main process whether a recovery snapshot exists,
//   * if so, raises a modal with exactly two actions: Restore / Start Fresh,
//   * on Restore, applies the recovered buffer to the editor session and
//     navigates to the recovered workspace; on Start Fresh, clears the
//     snapshot and stays.
//
// This module injects its own modal CSS + DOM so it works in any of the three
// renderer pages (mall, world, editor) without depending on the host page's
// modal scaffold. The probe runs AT MOST ONCE per page mount; subsequent
// navigations between pages do not re-prompt for the same snapshot.
//
// CSP/scope: this module is plain DOM + IPC. It does not need new permissions.

(function () {
  const STYLE_ID = 'wrlforge-recovery-prompt-style';
  const ROOT_ID = 'wrlforgeRecoveryRoot';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${ROOT_ID} {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,0.55); display: none;
        align-items: center; justify-content: center;
        font-family: -apple-system, "Segoe UI", sans-serif;
      }
      #${ROOT_ID}.show { display: flex; }
      #${ROOT_ID} .box {
        background: #1f1f22; color: #e0e0e0; border-radius: 8px;
        padding: 18px 20px; max-width: 640px; width: calc(100% - 32px);
        box-shadow: 0 10px 40px rgba(0,0,0,0.6);
        border: 1px solid #333;
        max-height: 80vh; display: flex; flex-direction: column;
      }
      #${ROOT_ID} h3 { margin: 0 0 6px; font-size: 16px; color: #fff; }
      #${ROOT_ID} p { margin: 0 0 14px; font-size: 13.5px; line-height: 1.45; color: #ccc; }
      #${ROOT_ID} .meta {
        background: #141417; border-radius: 4px; padding: 8px 10px;
        font-family: monospace; font-size: 11.5px; color: #aaa;
        margin-bottom: 14px; word-break: break-all;
      }
      #${ROOT_ID} .meta div { margin: 2px 0; }
      #${ROOT_ID} .meta .label { display: inline-block; width: 86px; color: #888; }
      #${ROOT_ID} .buffer-area {
        background: #141417; border: 1px solid #2a2a2e; border-radius: 4px;
        padding: 10px 12px; color: #ddd; font-family: ui-monospace, monospace;
        font-size: 12px; line-height: 1.4; white-space: pre-wrap; word-break: break-all;
        flex: 1 1 auto; min-height: 120px; max-height: 50vh; overflow: auto;
        margin-bottom: 12px; user-select: text; cursor: text;
      }
      #${ROOT_ID} .actions { display: flex; gap: 8px; justify-content: flex-end; }
      #${ROOT_ID} button {
        background: #2d6ae0; color: #fff; border: none; border-radius: 4px;
        padding: 8px 14px; font-size: 13px; cursor: pointer;
      }
      #${ROOT_ID} button:hover { background: #3a78ee; }
      #${ROOT_ID} button:focus-visible { outline: 2px solid #7db3ff; outline-offset: 2px; }
      #${ROOT_ID} button.secondary { background: #3a3a3a; }
      #${ROOT_ID} button.secondary:hover { background: #4a4a4a; }
      #${ROOT_ID} .copy-status {
        align-self: flex-end; margin-right: 8px; font-size: 11.5px;
        color: #7fe08a; height: 14px;
      }
    `;
    document.head.appendChild(s);
  }

  function ensureRoot() {
    let r = document.getElementById(ROOT_ID);
    if (r) return r;
    ensureStyles();
    r = document.createElement('div');
    r.id = ROOT_ID;
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-modal', 'true');
    r.setAttribute('aria-labelledby', ROOT_ID + 'Title');
    document.body.appendChild(r);
    return r;
  }

  function show({ title, message, meta, restoreLabel = 'Restore', freshLabel = 'Start Fresh', primary = 'restore' }) {
    const root = ensureRoot();
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'box';
    const h = document.createElement('h3');
    h.id = ROOT_ID + 'Title';
    h.textContent = title;
    box.appendChild(h);
    const p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);
    if (meta && meta.length) {
      const m = document.createElement('div');
      m.className = 'meta';
      for (const row of meta) {
        const d = document.createElement('div');
        const lbl = document.createElement('span');
        lbl.className = 'label';
        lbl.textContent = row.label;
        d.appendChild(lbl);
        const span = document.createElement('span');
        span.textContent = row.value;
        d.appendChild(span);
        m.appendChild(d);
      }
      box.appendChild(m);
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    const freshBtn = document.createElement('button');
    freshBtn.type = 'button';
    freshBtn.className = 'secondary';
    freshBtn.textContent = freshLabel;
    freshBtn.addEventListener('click', () => finish('fresh'));
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.textContent = restoreLabel;
    restoreBtn.addEventListener('click', () => finish('restore'));
    actions.appendChild(freshBtn);
    actions.appendChild(restoreBtn);
    box.appendChild(actions);
    root.appendChild(box);
    root.classList.add('show');
    if (primary === 'fresh') {
      freshBtn.classList.remove('secondary');
      restoreBtn.classList.add('secondary');
      freshBtn.focus();
    } else {
      restoreBtn.focus();
    }
    function finish(value) {
      root.classList.remove('show');
      root.innerHTML = '';
      if (handler) handler(value);
    }
    let handler = null;
    return new Promise((resolve) => { handler = resolve; });
  }

  // Phase Beta 2 (B2 fix) -- recovery viewer. Used when Restore cannot
  // mount a real editor session because the original source file is gone,
  // OR the recovery record lacks the source-stat conflict anchor (legacy
  // v1 records). Shows the recovered buffer as selectable plain text +
  // a Copy action so the user can keep their work and decide where to put
  // it. The recovery record STAYS on disk; closing the viewer is not the
  // same as Start Fresh.
  //
  // Returns a Promise that resolves with the user's choice:
  //   'close'  -- they dismissed the viewer; recovery still on disk
  //   'copied' -- they copied the buffer; recovery still on disk
  // The page the viewer was opened on remains usable after the modal closes.
  function showRecoveryViewer({ title, message, meta = [], buffer, subtitle }) {
    const root = ensureRoot();
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'box';
    const h = document.createElement('h3');
    h.id = ROOT_ID + 'Title';
    h.textContent = title;
    box.appendChild(h);
    const sub = document.createElement('p');
    sub.textContent = subtitle || '';
    box.appendChild(sub);
    if (message) {
      const m = document.createElement('p');
      m.textContent = message;
      box.appendChild(m);
    }
    if (meta.length) {
      const m = document.createElement('div');
      m.className = 'meta';
      for (const row of meta) {
        const d = document.createElement('div');
        const lbl = document.createElement('span');
        lbl.className = 'label';
        lbl.textContent = row.label;
        d.appendChild(lbl);
        const span = document.createElement('span');
        span.textContent = row.value;
        d.appendChild(span);
        m.appendChild(d);
      }
      box.appendChild(m);
    }
    // The buffer is rendered as a contenteditable DIV (not a true input)
    // so the user can select any portion and copy it. We deliberately do
    // NOT write back into the buffer through this UI -- it is read-only.
    const area = document.createElement('pre');
    area.className = 'buffer-area';
    area.setAttribute('readonly', 'readonly');
    area.setAttribute('aria-label', 'Recovered text (read-only; select and copy to keep)');
    area.textContent = typeof buffer === 'string' ? buffer : '';
    box.appendChild(area);
    // Copy-status indicator lives next to the buttons so the user gets a
    // visible acknowledgement without an alert.
    const status = document.createElement('span');
    status.className = 'copy-status';
    status.setAttribute('aria-live', 'polite');
    box.appendChild(status);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'secondary';
    closeBtn.textContent = 'Close (recovery stays)';
    closeBtn.addEventListener('click', () => finish('close'));
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy to clipboard';
    copyBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(area.textContent);
        } else {
          // Fallback: use a temporary textarea + execCommand. Browser
          // support for clipboard.writeText is universal in our target
          // environments, but the fallback keeps older browsers usable.
          const ta = document.createElement('textarea');
          ta.value = area.textContent;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (e) { /* swallow */ }
          ta.remove();
        }
        status.textContent = 'Copied.';
      } catch (err) {
        status.textContent = 'Copy failed; use Ctrl+C / Cmd+C.';
      }
    });
    actions.appendChild(closeBtn);
    actions.appendChild(copyBtn);
    box.appendChild(actions);
    root.appendChild(box);
    root.classList.add('show');
    area.focus();
    try { const r = document.createRange(); r.selectNodeContents(area); const s = window.getSelection(); if (s) { s.removeAllRanges(); s.addRange(r); } } catch (e) { /* noop */ }
    function finish(value) {
      root.classList.remove('show');
      root.innerHTML = '';
      if (handler) handler(value);
    }
    let handler = null;
    return new Promise((resolve) => { handler = resolve; });
  }

  // ---- main routine ----------------------------------------------------
  // Idempotency: the prompt fires AT MOST ONCE per app session. After the
  // user makes a decision (Restore or Start Fresh), subsequent maybePrompt
  // calls on the same session are silent -- the user has already decided,
  // and showing the prompt again would be either confusing (Restore after
  // Start Fresh) or duplicate (Restore after Restore). The flag is held in
  // sessionStorage so it survives page navigations within the same session
  // but resets on a fresh launch.
  const IDEMPOTENCY_KEY = 'wrlforge.recovery.prompted';
  function alreadyPrompted() {
    try { return window.sessionStorage && window.sessionStorage.getItem(IDEMPOTENCY_KEY) === '1'; } catch { return false; }
  }
  function markPrompted() {
    try { if (window.sessionStorage) window.sessionStorage.setItem(IDEMPOTENCY_KEY, '1'); } catch { /* noop */ }
  }
  // Used by the explicit Start Fresh path so the user can re-decide if the
  // page reloads after they made the choice. We deliberately do NOT expose
  // this on window -- only the Start Fresh action itself calls it.
  function resetPrompted() {
    try { if (window.sessionStorage) window.sessionStorage.removeItem(IDEMPOTENCY_KEY); } catch { /* noop */ }
  }

  async function maybePrompt({ onRestore, onFresh, skipPages = [] } = {}) {
    try {
      const page = (location.pathname || '').split('/').pop() || '';
      if (skipPages.includes(page)) return;
      const bridge = window.vrmlpad && window.vrmlpad.editor;
      if (!bridge || !bridge.recoveryRead) return;
      // Idempotency guard: if we already decided this session, stay silent.
      if (alreadyPrompted()) return;
      const r = await bridge.recoveryRead();
      if (!r || !r.found) return;
      const rec = r.record || {};
      // Build a short meta summary so the user knows what they're restoring.
      const meta = [];
      meta.push({ label: 'Workspace:', value: rec.activeWorkspace || 'editor' });
      meta.push({ label: 'Source:', value: rec.sourcePath || '(unsaved buffer)' });
      meta.push({ label: 'Format:', value: rec.format || 'plain' });
      meta.push({ label: 'Length:', value: String((rec.buffer || '').length) + ' chars' });
      if (rec.updatedAt) {
        try {
          const d = new Date(rec.updatedAt);
          meta.push({ label: 'Saved:', value: d.toLocaleString() });
        } catch { /* noop */ }
      }
      // Mark BEFORE the modal opens so a simultaneous duplicate mount of the
      // prompt (which cannot happen given the script's co-load semantics, but
      // is cheap to defend against) does not double-fire.
      markPrompted();
      const choice = await show({
        title: 'Recovered unsaved work was found.',
        message: 'WRL Forge detected editor work that had not been saved to its source file when the app last exited. Restore it, or start fresh and forget it. The source file on disk is unchanged either way.',
        meta,
      });
      if (choice === 'fresh') {
        try { await bridge.recoveryClear(); } catch (e) { /* noop */ }
        if (typeof onFresh === 'function') onFresh(rec);
        return;
      }
      if (choice === 'restore') {
        let adopted = null;
        try { adopted = await bridge.recoveryAdopt(); } catch (e) { adopted = { ok: false, reason: 'exception', error: String(e && e.message || e) }; }
        if (!adopted || !adopted.ok) {
          // The adopt failed -- KEEP the recovery file (do NOT clear it), so
          // the user can re-decide on the next launch / reload. The prompt
          // stays suppressed in this session because the user already saw
          // it; the recovery remains on disk until Save / Discard / Start
          // Fresh. (Phase Beta 2 correction: a failed Restore is not Start
          // Fresh, and never deletes recovered text.)
          if (typeof onRestore === 'function') {
            await onRestore({ ok: false, reason: adopted && adopted.reason || 'unknown' }, rec);
          }
          return;
        }
        // B2 / legacy-snapshot path: when the original source file is
        // missing OR the recovery has no source-stat anchor, the editor
        // session cannot mount safely (a Save would be ambiguous). Surface
        // the recovered buffer through the recovery viewer instead: the
        // user can SELECT and COPY the text, and the recovery record
        // STAYS on disk until they perform a real Save or Start Fresh.
        if (adopted && adopted.sourceMissingRecovered) {
          await showRecoveryViewer({
            title: 'Source file is missing',
            subtitle: 'The original source file is no longer on disk. Your unsaved work is preserved; WRL Forge will offer it again on next launch.',
            message: 'Use Ctrl+C / Cmd+C or the Copy button to keep the text below. Closing this viewer does NOT delete the recovery record.',
            meta: [
              { label: 'Original path:', value: (adopted.sourcePath || rec.sourcePath || '(unknown)') },
              { label: 'Length:', value: String((adopted.buffer || rec.buffer || '').length) + ' chars' },
            ],
            buffer: adopted.buffer || rec.buffer || '',
          });
          return;
        }
        if (typeof onRestore === 'function') {
          await onRestore(adopted, rec);
          return;
        }
        // Default behavior: ALWAYS navigate to the editor. The recovered
        // buffer is opened in the main editor session by adoptRecovery; the
        // editor page is the only page that surfaces it. The activeWorkspace
        // field is shown to the user in the prompt meta so they can see
        // where they were before the crash.
        if (window.vrmlpad && window.vrmlpad.goto) {
          try { await window.vrmlpad.goto('editor'); } catch (e) { /* stay */ }
        }
      }
    } catch (err) {
      // A failed probe MUST NOT block page load -- the recovery is best-effort.
      try { console.warn('[wrlforge-recovery] probe failed:', err && (err.message || err)); } catch { /* noop */ }
    }
  }

  window.WRLForgeRecoveryPrompt = { maybePrompt, show, showRecoveryViewer };
})();
