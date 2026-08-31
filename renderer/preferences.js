'use strict';
// Phase: Preferences & Settings -- the renderer-side shared preferences state
// + the single Preferences & Settings dialog.
//
// One shared authority: a module-scope state object derived from localStorage
// (the same keys renderer/editor.js has used since Phase 7B). The dialog,
// the editor's existing theme/zoom/layout controls, and any future surface
// all read and write through this module. There is no shadow value anywhere
// in the renderer.
//
// The dialog implements the full accessibility contract (role="dialog",
// aria-modal, labelled title, Escape to close, focus containment, focus
// return to the opener). No native alert/confirm/prompt; no framework.
//
// Changes apply immediately (no Save button) because every setting the
// dialog exposes is already live-applied by the existing controls it mirrors.

(function () {
  if (typeof window === 'undefined') return;
  const Core = window.WrlPreferencesCore;
  if (!Core) {
    // preferences.js failed to load -- the page will continue to function via
    // its own pre-existing localStorage reads, but the Preferences button
    // and dialog will not be available. Log a single warning so the failure
    // is visible during development.
    try { console.warn('[wrlforge-prefs] preferences core missing; dialog disabled.'); } catch (e) {}
    return;
  }

  // ---- state ----------------------------------------------------------------

  const state = {
    prefs: Core.read(window.localStorage),
    // Subscribers are notified after every successful set; they receive the
    // full new state object so each subscriber can refresh only the parts it
    // owns. Order is preserved (insertion order). Errors are swallowed.
    subscribers: [],
  };

  function notify() {
    for (const fn of state.subscribers) {
      try { fn(state.prefs); } catch (e) { /* noop */ }
    }
  }

  function get(key) {
    return key ? state.prefs[key] : state.prefs;
  }

  function set(key, value) {
    const next = Core.update(state.prefs, key, value);
    if (next === state.prefs) return state.prefs;
    state.prefs = next;
    Core.write(window.localStorage, state.prefs);
    notify();
    return state.prefs;
  }

  function setHighContrast(enabled) {
    const next = Core.setHighContrastEnabled(state.prefs, !!enabled);
    if (next === state.prefs) return state.prefs;
    state.prefs = next;
    Core.write(window.localStorage, state.prefs);
    notify();
    return state.prefs;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    state.subscribers.push(fn);
    // Fire immediately so a fresh subscriber sees the current state.
    try { fn(state.prefs); } catch (e) { /* noop */ }
    return function unsubscribe() {
      const i = state.subscribers.indexOf(fn);
      if (i >= 0) state.subscribers.splice(i, 1);
    };
  }

  // ---- live apply functions -------------------------------------------------

  // Apply the current theme to the editor's CodeMirror surface (if mounted)
  // and synchronize the editor toolbar's <select>. Live, no Save.
  function applyTheme(themeId) {
    if (!Core.isValidTheme(themeId)) return;
    if (window.__wrlEditor && typeof window.__wrlEditor.setTheme === 'function') {
      try { window.__wrlEditor.setTheme(themeId); } catch (e) { /* handle not ready */ }
    }
    const sel = document.getElementById('themeSelect');
    if (sel && sel.value !== themeId) {
      sel.value = themeId;
    }
  }

  // Apply the current zoom level: code font + app chrome (--wrl-ui-scale) +
  // zoom label + zoom-button enabled state. Live, no Save.
  function applyZoom(level) {
    const z = Core.zoomModel(level);
    if (window.__wrlEditor && typeof window.__wrlEditor.setFontSize === 'function') {
      try { window.__wrlEditor.setFontSize(z.codeFontPx); } catch (e) { /* handle not ready */ }
    }
    try { document.documentElement.style.setProperty('--wrl-ui-scale', String(z.chromeScale)); }
    catch (e) { /* noop */ }
    const lbl = document.getElementById('zoomLabel');
    if (lbl) {
      lbl.textContent = z.label;
      lbl.setAttribute('aria-label', 'Editor size ' + z.label);
    }
  }

  // Apply the current preview layout to the editor's live preview (if any).
  // Live, no Save. A non-editor page has no preview layout to apply; the
  // setting is still persisted and the editor will pick it up on mount.
  function applyPreviewLayout(layout) {
    if (!Core.isValidPreviewLayout(layout)) return;
    if (window.wrlEditorPreview && typeof window.wrlEditorPreview.setLayout === 'function') {
      try { window.wrlEditorPreview.setLayout(layout); } catch (e) { /* not started */ }
    }
    const sel = document.getElementById('previewLayoutSelect');
    if (sel && sel.value !== layout) sel.value = layout;
  }

  // ---- dialog ---------------------------------------------------------------

  // One dialog root, lazy-mounted on first show. The root is a single
  // full-viewport backdrop with `role="dialog" aria-modal="true"`. Focus
  // is trapped inside the dialog while open and returned to the opener on
  // close. Escape closes the dialog.
  const ROOT_ID = 'wrlforgePrefsRoot';
  const STORAGE_KEY = 'wrlforge.dialog.lastOpenerId';

  function ensureStyles() {
    if (document.getElementById('wrlforge-prefs-style')) return;
    const s = document.createElement('style');
    s.id = 'wrlforge-prefs-style';
    s.textContent = [
      '#' + ROOT_ID + ' {',
      '  position: fixed; inset: 0; z-index: 10000;',
      '  background: rgba(0,0,0,0.62);',
      '  display: none; align-items: center; justify-content: center;',
      '  font-family: -apple-system, "Segoe UI", sans-serif;',
      '}',
      '#' + ROOT_ID + '.show { display: flex; }',
      '#' + ROOT_ID + ' .wrlforge-prefs-box {',
      '  background: #1f1f22; color: #e0e0e0;',
      '  border: 1px solid #3a3a3a; border-radius: 10px;',
      '  padding: 22px 24px 18px; width: min(640px, calc(100% - 32px));',
      '  max-height: 86vh; overflow: auto;',
      '  box-shadow: 0 12px 44px rgba(0,0,0,0.65);',
      '}',
      '#' + ROOT_ID + ' h2 { margin: 0 0 4px; font-size: 17px; color: #fff; }',
      '#' + ROOT_ID + ' h3 {',
      '  margin: 18px 0 8px; font-size: 11px; color: #9ab;',
      '  text-transform: uppercase; letter-spacing: 0.06em;',
      '  border-top: 1px solid #2a2a2a; padding-top: 14px;',
      '}',
      '#' + ROOT_ID + ' h3:first-of-type { border-top: none; padding-top: 0; margin-top: 10px; }',
      '#' + ROOT_ID + ' h4 { margin: 8px 0 4px; font-size: 12px; color: #d0d0d0; }',
      '#' + ROOT_ID + ' .hint { color: #8a8a8a; font-size: 11.5px; margin: 2px 0 6px; }',
      '#' + ROOT_ID + ' .field { margin: 8px 0 4px; }',
      '#' + ROOT_ID + ' label.row { display: flex; gap: 8px; align-items: center; font-size: 13px; }',
      '#' + ROOT_ID + ' label.toggle {',
      '  display: inline-flex; gap: 8px; align-items: center; cursor: pointer;',
      '  font-size: 13px; padding: 4px 0;',
      '}',
      '#' + ROOT_ID + ' label.toggle input { width: 16px; height: 16px; accent-color: #2d6ae0; }',
      '#' + ROOT_ID + ' select, #' + ROOT_ID + ' input[type=text] {',
      '  background: #2a2a2a; color: #e6e6e6; border: 1px solid #3a3a3a;',
      '  border-radius: 4px; padding: 5px 8px; font-size: 13px; min-width: 160px;',
      '}',
      '#' + ROOT_ID + ' select:focus-visible, #' + ROOT_ID + ' input:focus-visible,',
      '#' + ROOT_ID + ' button:focus-visible {',
      '  outline: 2px solid #7db3ff; outline-offset: 2px;',
      '}',
      '#' + ROOT_ID + ' .zoom-row { display: flex; gap: 6px; align-items: center; }',
      '#' + ROOT_ID + ' .zoom-row .label {',
      '  min-width: 3.4rem; text-align: center; color: #cbd;',
      '  font-variant-numeric: tabular-nums; font-size: 13px;',
      '  padding: 0 6px;',
      '}',
      '#' + ROOT_ID + ' .zoom-row .label[aria-live] { padding: 0 6px; }',
      '#' + ROOT_ID + ' button {',
      '  background: #2d6ae0; color: #fff; border: none; border-radius: 4px;',
      '  padding: 5px 12px; font-size: 13px; cursor: pointer;',
      '}',
      '#' + ROOT_ID + ' button:hover { background: #3a78ee; }',
      '#' + ROOT_ID + ' button.secondary { background: #3a3a3a; }',
      '#' + ROOT_ID + ' button.secondary:hover { background: #4a4a4a; }',
      '#' + ROOT_ID + ' .actions {',
      '  display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px;',
      '  border-top: 1px solid #2a2a2a; padding-top: 14px;',
      '}',
      '#' + ROOT_ID + ' table.shortcut-table {',
      '  border-collapse: collapse; width: 100%; margin-top: 4px;',
      '  font-size: 12.5px;',
      '}',
      '#' + ROOT_ID + ' table.shortcut-table th, #' + ROOT_ID + ' table.shortcut-table td {',
      '  text-align: left; padding: 4px 6px;',
      '  border-bottom: 1px solid #262626;',
      '}',
      '#' + ROOT_ID + ' table.shortcut-table th { color: #8a8a8a; font-weight: 500; }',
      '#' + ROOT_ID + ' kbd {',
      '  background: #2a2a2a; color: #e0e0e0; border: 1px solid #3a3a3a;',
      '  border-radius: 3px; padding: 1px 6px; font-family: monospace; font-size: 11.5px;',
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // The complete keyboard shortcut table. Read-only reference; the dialog
  // never re-maps these (out of scope for this lane).
  const SHORTCUTS = [
    { action: 'Repack (Mall)', keys: 'Ctrl+R' },
    { action: 'Open in Native Editor (Mall)', keys: 'Ctrl+E' },
    { action: 'Save (Editor)', keys: 'Ctrl+S' },
    { action: 'Save As (Editor)', keys: 'Ctrl+Shift+S' },
    { action: 'Go to line (Editor)', keys: 'Ctrl+G' },
    { action: 'Close document (Editor)', keys: 'Ctrl+W' },
    { action: 'Increase UI size', keys: 'Ctrl++' },
    { action: 'Decrease UI size', keys: 'Ctrl+-' },
    { action: 'Reset UI size', keys: 'Ctrl+0' },
    { action: 'Update preview (Editor)', keys: 'Ctrl+Enter' },
    { action: 'Maximize preview (Editor)', keys: 'Ctrl+Shift+Enter' },
  ];

  function buildDialogDom() {
    ensureStyles();
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', ROOT_ID + 'Title');

    const box = document.createElement('div');
    box.className = 'wrlforge-prefs-box';

    const h2 = document.createElement('h2');
    h2.id = ROOT_ID + 'Title';
    h2.textContent = 'Preferences & Settings';
    box.appendChild(h2);

    const subtitle = document.createElement('p');
    subtitle.className = 'hint';
    subtitle.textContent = 'Changes apply immediately. No Save button needed.';
    box.appendChild(subtitle);

    // ---- Appearance section ----
    const aSec = document.createElement('section');
    aSec.setAttribute('aria-labelledby', ROOT_ID + 'Appearance');
    const aH = document.createElement('h3');
    aH.id = ROOT_ID + 'Appearance';
    aH.textContent = 'Appearance';
    aSec.appendChild(aH);
    aSec.appendChild(buildThemeField('theme', ROOT_ID + 'Theme'));
    aSec.appendChild(buildZoomField('zoom', ROOT_ID + 'Zoom', ROOT_ID + 'ZoomLabel'));
    box.appendChild(aSec);

    // ---- Accessibility section ----
    const xSec = document.createElement('section');
    xSec.setAttribute('aria-labelledby', ROOT_ID + 'A11y');
    const xH = document.createElement('h3');
    xH.id = ROOT_ID + 'A11y';
    xH.textContent = 'Accessibility';
    xSec.appendChild(xH);
    xSec.appendChild(buildHighContrastField('hc', ROOT_ID + 'HC'));
    xSec.appendChild(buildZoomField('zoom2', ROOT_ID + 'Zoom2', ROOT_ID + 'Zoom2Label'));

    const a11yNote = document.createElement('h4');
    a11yNote.textContent = 'Keyboard access';
    xSec.appendChild(a11yNote);
    const a11yPara = document.createElement('p');
    a11yPara.className = 'hint';
    a11yPara.textContent = 'Every control here is reachable with the Tab key. Press Enter or Space to activate. Press Escape to close this dialog and return to where you were.';
    xSec.appendChild(a11yPara);
    box.appendChild(xSec);

    // ---- Keyboard section ----
    const kSec = document.createElement('section');
    kSec.setAttribute('aria-labelledby', ROOT_ID + 'Keys');
    const kH = document.createElement('h3');
    kH.id = ROOT_ID + 'Keys';
    kH.textContent = 'Keyboard shortcuts';
    kSec.appendChild(kH);
    kSec.appendChild(buildShortcutTable());
    const kbHint = document.createElement('p');
    kbHint.className = 'hint';
    kbHint.textContent = 'Shortcut remapping is not available yet.';
    kSec.appendChild(kbHint);
    box.appendChild(kSec);

    // ---- Editor section ----
    const eSec = document.createElement('section');
    eSec.setAttribute('aria-labelledby', ROOT_ID + 'Editor');
    const eH = document.createElement('h3');
    eH.id = ROOT_ID + 'Editor';
    eH.textContent = 'Editor';
    eSec.appendChild(eH);
    eSec.appendChild(buildThemeField('theme2', ROOT_ID + 'Theme2'));
    eSec.appendChild(buildZoomField('zoom3', ROOT_ID + 'Zoom3', ROOT_ID + 'Zoom3Label'));
    eSec.appendChild(buildPreviewLayoutField('layout', ROOT_ID + 'Layout'));
    box.appendChild(eSec);

    // ---- Actions ----
    const actions = document.createElement('div');
    actions.className = 'actions';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.id = ROOT_ID + 'Close';
    closeBtn.textContent = 'Close';
    closeBtn.setAttribute('aria-label', 'Close Preferences');
    closeBtn.addEventListener('click', () => closeDialog());
    actions.appendChild(closeBtn);
    box.appendChild(actions);

    root.appendChild(box);
    document.body.appendChild(root);
    return root;
  }

  function buildThemeField(idBase, selectId) {
    const f = document.createElement('div');
    f.className = 'field';
    const label = document.createElement('label');
    label.htmlFor = selectId;
    label.textContent = 'Editor color theme';
    f.appendChild(label);
    const sel = document.createElement('select');
    sel.id = selectId;
    sel.setAttribute('aria-label', 'Editor color theme');
    for (const t of Core.THEMES) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = Core.THEME_LABELS[t];
      sel.appendChild(opt);
    }
    f.appendChild(sel);
    sel.addEventListener('change', () => set('theme', sel.value));
    return f;
  }

  function buildZoomField(idBase, baseId, labelId) {
    const f = document.createElement('div');
    f.className = 'field';
    const label = document.createElement('label');
    label.textContent = 'UI size';
    label.id = baseId + 'Label';
    f.appendChild(label);
    const row = document.createElement('div');
    row.className = 'zoom-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'UI size');
    const out = document.createElement('button');
    out.type = 'button';
    out.id = baseId + 'Out';
    out.setAttribute('aria-label', 'Decrease size');
    out.textContent = '\u2212';
    const lbl = document.createElement('span');
    lbl.id = labelId;
    lbl.className = 'label';
    lbl.setAttribute('aria-live', 'polite');
    lbl.textContent = '100%';
    const inn = document.createElement('button');
    inn.type = 'button';
    inn.id = baseId + 'In';
    inn.setAttribute('aria-label', 'Increase size');
    inn.textContent = '+';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.id = baseId + 'Reset';
    reset.className = 'secondary';
    reset.textContent = 'Reset';
    row.appendChild(out);
    row.appendChild(lbl);
    row.appendChild(inn);
    row.appendChild(reset);
    f.appendChild(row);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Scales the code area and app chrome together. Use Ctrl++ / Ctrl+- / Ctrl+0 anywhere in the app.';
    f.appendChild(hint);

    out.addEventListener('click', () => set('zoom', Core.clampZoom(get('zoom') - 1)));
    inn.addEventListener('click', () => set('zoom', Core.clampZoom(get('zoom') + 1)));
    reset.addEventListener('click', () => set('zoom', Core.DEFAULTS.zoom));
    return f;
  }

  function buildHighContrastField(idBase, inputId) {
    const f = document.createElement('div');
    f.className = 'field';
    const lab = document.createElement('label');
    lab.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = inputId;
    input.setAttribute('aria-describedby', inputId + 'Hint');
    const span = document.createElement('span');
    span.textContent = 'Use High Contrast theme';
    lab.appendChild(input);
    lab.appendChild(span);
    f.appendChild(lab);
    const hint = document.createElement('div');
    hint.id = inputId + 'Hint';
    hint.className = 'hint';
    hint.textContent = 'For low-vision use. The same option is also available from Appearance > Editor color theme > High Contrast. Turning this off restores your previous theme.';
    f.appendChild(hint);
    input.addEventListener('change', () => setHighContrast(input.checked));
    return f;
  }

  function buildPreviewLayoutField(idBase, selectId) {
    const f = document.createElement('div');
    f.className = 'field';
    const label = document.createElement('label');
    label.htmlFor = selectId;
    label.textContent = 'Preview layout (editor)';
    f.appendChild(label);
    const sel = document.createElement('select');
    sel.id = selectId;
    sel.setAttribute('aria-label', 'Preview layout');
    for (const l of Core.PREVIEW_LAYOUTS) {
      const opt = document.createElement('option');
      opt.value = l;
      opt.textContent = Core.PREVIEW_LAYOUT_LABELS[l];
      sel.appendChild(opt);
    }
    f.appendChild(sel);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Also controlled by the Layout dropdown in the editor toolbar. Applies to the Mall + World live preview.';
    f.appendChild(hint);
    sel.addEventListener('change', () => set('previewLayout', sel.value));
    return f;
  }

  function buildShortcutTable() {
    const t = document.createElement('table');
    t.className = 'shortcut-table';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    const th1 = document.createElement('th');
    th1.textContent = 'Action';
    const th2 = document.createElement('th');
    th2.textContent = 'Shortcut';
    trh.appendChild(th1);
    trh.appendChild(th2);
    thead.appendChild(trh);
    t.appendChild(thead);
    const tb = document.createElement('tbody');
    for (const s of SHORTCUTS) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = s.action;
      const td2 = document.createElement('td');
      const kbd = document.createElement('kbd');
      kbd.textContent = s.keys;
      td2.appendChild(kbd);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    return t;
  }

  // Track the current opener (focused element before the dialog opened) so
  // focus returns correctly on close. The opener is captured fresh on each
  // open because the page may have navigated.
  let lastOpener = null;
  let previousActiveElement = null;
  let escListenerInstalled = false;
  let focusTrapListenerInstalled = false;

  function getFocusable(root) {
    if (!root) return [];
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const nodes = root.querySelectorAll(sel);
    return Array.from(nodes).filter((n) => {
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return false;
      // Skip elements that are display:none.
      if (n.offsetParent === null && n.tagName !== 'BODY') return false;
      return true;
    });
  }

  function onKeydown(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    } else if (e.key === 'Tab') {
      // Contain focus inside the dialog.
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      const focusables = getFocusable(root);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || !focusables.includes(a))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && a === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Refresh every mirrored control to reflect the latest state. Called
  // (a) on dialog open and (b) after every state change so the dialog
  // mirrors external edits (e.g. the editor's own themeSelect was changed).
  function paintDialog() {
    const p = state.prefs;
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const themeSel = root.querySelector('#' + ROOT_ID + 'Theme');
    if (themeSel) themeSel.value = p.theme;
    const themeSel2 = root.querySelector('#' + ROOT_ID + 'Theme2');
    if (themeSel2) themeSel2.value = p.theme;
    const z = Core.zoomModel(p.zoom);
    for (const suffix of ['', '2', '3']) {
      const baseId = suffix ? ROOT_ID + 'Zoom' + suffix : ROOT_ID + 'Zoom';
      const lblId = suffix ? ROOT_ID + 'Zoom' + suffix + 'Label' : ROOT_ID + 'ZoomLabel';
      const lbl = root.querySelector('#' + lblId);
      if (lbl) lbl.textContent = z.label;
    }
    const hc = root.querySelector('#' + ROOT_ID + 'HC');
    if (hc) hc.checked = Core.highContrastEnabled(p);
    const layoutSel = root.querySelector('#' + ROOT_ID + 'Layout');
    if (layoutSel) layoutSel.value = p.previewLayout;
  }

  function openDialog(opener) {
    const root = buildDialogDom();
    // Capture the current opener for focus return. If the caller passed a
    // specific element (e.g. the button that opened us), prefer it; otherwise
    // fall back to the current activeElement (works for keyboard activation).
    lastOpener = opener || document.activeElement;
    previousActiveElement = document.activeElement;
    // Subscribe so the dialog mirrors external edits in real time.
    if (!state._dialogUnsubscribe) {
      state._dialogUnsubscribe = subscribe(paintDialog);
    }
    paintDialog();
    root.classList.add('show');
    if (!escListenerInstalled) {
      document.addEventListener('keydown', onKeydown, true);
      escListenerInstalled = true;
    }
    if (!focusTrapListenerInstalled) {
      // Focus trap is handled inside onKeydown (Tab/Shift+Tab cycle).
      focusTrapListenerInstalled = true;
    }
    // Move focus into the dialog: the first focusable control.
    const focusables = getFocusable(root);
    if (focusables.length) focusables[0].focus();
  }

  function closeDialog() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.classList.remove('show');
    if (escListenerInstalled) {
      document.removeEventListener('keydown', onKeydown, true);
      escListenerInstalled = false;
    }
    // Return focus to the opener if it's still in the DOM and not disabled;
    // otherwise to the element that was active when the dialog opened.
    const target = (lastOpener && document.body.contains(lastOpener) && !lastOpener.disabled)
      ? lastOpener
      : (previousActiveElement && document.body.contains(previousActiveElement) ? previousActiveElement : null);
    if (target && typeof target.focus === 'function') {
      try { target.focus(); } catch (e) { /* noop */ }
    }
    lastOpener = null;
    previousActiveElement = null;
  }

  // ---- button wiring --------------------------------------------------------

  // One tiny helper for pages that want a Preferences button in their
  // toolbar. The button is created with the same compact chrome as the
  // surrounding toolbar and opens the dialog. The host page wires it up
  // with a single call.
  function createButton({ id, label = 'Preferences & Settings', ariaLabel } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id || 'prefsBtn';
    btn.className = 'secondary';
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel || label);
    btn.addEventListener('click', () => openDialog(btn));
    return btn;
  }

  // Expose the public surface.
  window.WrlPreferences = {
    get, set, setHighContrast, subscribe,
    applyTheme, applyZoom, applyPreviewLayout,
    show: openDialog, close: closeDialog,
    createButton,
    Core,
  };
})();
