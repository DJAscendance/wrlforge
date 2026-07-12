// Native editor view (Phase 7B) -- the CodeMirror 6 assembly, bundled to
// renderer/vendor/wrl-editor.bundle.js by `npm run build:editor` (esbuild). This
// is the ONLY file that touches CodeMirror; all VRML language logic comes from
// ../language.js (which is the Phase 7A parser, the single grammar authority).
//
// Exposes window.WrlEditor.create(parent, opts) -> a handle the renderer drives.
// Highlighting and SYNTAX diagnostics recompute on a bounded debounce off the
// real tokenizer/parser; stale results are dropped by a monotonic doc version so
// a late parse can never apply diagnostics from an older buffer.

import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, Decoration,
} from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching } from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import * as language from '../language.js';

const analyze = language.analyze;

// --- tokenizer-driven highlight layer ---------------------------------------
const setHighlights = StateEffect.define();

const highlightField = StateField.define({
  create() { return Decoration.none; },
  update(deco, tr) {
    deco = deco.map(tr.changes); // keep spans roughly aligned between parses
    for (const e of tr.effects) {
      if (e.is(setHighlights)) deco = buildDecorations(tr.state, e.value);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildDecorations(state, highlights) {
  const docLen = state.doc.length;
  const spans = highlights
    .filter((h) => h.from < h.to && h.from >= 0 && h.to <= docLen)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const ranges = spans.map((h) => Decoration.mark({ class: `cm-vrml-${h.cls}` }).range(h.from, h.to));
  return Decoration.set(ranges, true);
}

// --- theme (styles are injected by CodeMirror; kept neutral for a light UI) --
const vrmlTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-vrml-header': { color: '#6a737d', fontStyle: 'italic' },
  '.cm-vrml-comment': { color: '#6a737d', fontStyle: 'italic' },
  '.cm-vrml-keyword': { color: '#a626a4' },
  '.cm-vrml-def': { color: '#a626a4', fontWeight: '600' },
  '.cm-vrml-use': { color: '#a626a4', fontWeight: '600' },
  '.cm-vrml-route': { color: '#a626a4', fontWeight: '600' },
  '.cm-vrml-proto': { color: '#a626a4', fontWeight: '600' },
  '.cm-vrml-is': { color: '#a626a4' },
  '.cm-vrml-null': { color: '#0184bc' },
  '.cm-vrml-bool': { color: '#0184bc' },
  '.cm-vrml-nodeType': { color: '#c18401', fontWeight: '600' },
  '.cm-vrml-defName': { color: '#e45649', fontWeight: '600' },
  '.cm-vrml-useName': { color: '#e45649' },
  '.cm-vrml-fieldName': { color: '#4078f2' },
  '.cm-vrml-number': { color: '#986801' },
  '.cm-vrml-string': { color: '#50a14f' },
  '.cm-vrml-invalid': { color: '#e45649', textDecoration: 'underline wavy #e45649' },
  '.cm-vrml-bracket': { color: '#383a42' },
});

// --- editor handle -----------------------------------------------------------
function create(parent, opts = {}) {
  const options = opts || {};
  const profile = options.profile || 'generic';
  const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 250;
  const editable = new Compartment();

  let version = 0; // monotonic; bumps on every doc change and every re-analyze
  let pending = null; // debounce timer

  const listener = EditorView.updateListener.of((update) => {
    if (update.docChanged && typeof options.onChange === 'function') {
      options.onChange(update.state.doc.toString());
    }
    if ((update.docChanged || update.selectionSet) && typeof options.onCursor === 'function') {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head);
      options.onCursor({ line: line.number, column: head - line.from + 1 });
    }
    if (update.docChanged) scheduleAnalyze();
  });

  // Hoisted so setDoc can rebuild a fresh EditorState (which resets undo history)
  // without re-listing the configuration.
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    bracketMatching(),
    search({ top: true }),
    highlightSelectionMatches(),
    lintGutter(),
    highlightField,
    vrmlTheme,
    editable.of(EditorView.editable.of(options.readOnly !== true)),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    listener,
  ];

  const view = new EditorView({ state: EditorState.create({ doc: options.doc || '', extensions }), parent });

  function scheduleAnalyze() {
    if (pending) clearTimeout(pending);
    const forVersion = ++version;
    pending = setTimeout(() => runAnalyze(forVersion), debounceMs);
  }

  function runAnalyze(forVersion) {
    // Drop a stale parse: if the buffer moved on while we were scheduled, this
    // result is for an older version and must not apply.
    if (forVersion !== version) return;
    const text = view.state.doc.toString();
    let result;
    try {
      result = analyze(text, { profile });
    } catch {
      // A parser fault must never wipe the last good editor state; leave the
      // current highlights/diagnostics in place.
      return;
    }
    if (forVersion !== version) return; // moved on during analyze
    view.dispatch({ effects: setHighlights.of(result.highlights) });
    view.dispatch(setDiagnostics(view.state, result.diagnostics.map((d) => ({
      from: d.from, to: d.to, severity: d.severity, message: d.message, source: d.code,
    }))));
    if (typeof options.onAnalysis === 'function') {
      options.onAnalysis({
        diagnostics: result.diagnostics,
        advisories: result.advisories,
        outline: result.outline,
        meta: result.meta,
      });
    }
  }

  runAnalyze(++version); // initial synchronous pass so the first paint is highlighted

  return {
    view,
    getText: () => view.state.doc.toString(),
    setDoc(text) {
      // Fresh state -> resets undo history (a reload/open is not undoable back
      // into the previous file), then re-analyze.
      view.setState(EditorState.create({ doc: text, extensions }));
      runAnalyze(++version);
    },
    focus: () => view.focus(),
    setReadOnly(ro) { view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!ro)) }); },
    revealRange(from, to) {
      const len = view.state.doc.length;
      const a = Math.max(0, Math.min(from, len));
      const b = Math.max(a, Math.min(to == null ? from : to, len));
      view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true });
      view.focus();
    },
    gotoLine(line) {
      const n = Math.max(1, Math.min(line, view.state.doc.lines));
      const l = view.state.doc.line(n);
      view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
      view.focus();
    },
    reanalyzeNow() { runAnalyze(++version); },
    destroy() { if (pending) clearTimeout(pending); view.destroy(); },
  };
}

window.WrlEditor = { create };
