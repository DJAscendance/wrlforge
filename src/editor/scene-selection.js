'use strict';
// Scene-tree selection authority (Phase WD2-A).
//
// A single selection state -- one controller per editor workspace, shared by
// the scene-tree view and the inspector. There is deliberately no per-view
// selection mirror: a future edit pane would attach to the SAME controller,
// so renaming or deleting a node has one authoritative "what is the user
// looking at" answer.
//
// The controller is pure-ish: it carries one id (the scene item id), fires
// listener callbacks on change, and exposes no DOM, no event names, and no
// implicit globals. It is unit-testable in Node with no harness and runs in
// the renderer unchanged.
//
// Two invariants the rest of the lane relies on:
//   * Setting the same id twice is a no-op (no spurious re-render).
//   * Listeners added before setSelection are fired synchronously by setSelection
//     in subscription order.
//   * Returning a fresh unsubscribe function from subscribe, so a removed view
//     stops firing even if its DOM node was kept around.

const SCENE_SELECTION_ERROR = Object.freeze({
  INVALID_LISTENER: 'ESCENESELECTIONINVALIDLISTENER',
});

function createSelectionController() {
  let currentId = null;
  const listeners = new Set();
  let counter = 0;

  function fire(id) {
    // Snapshot to an array first so a listener that unsubscribes mid-loop
    // cannot corrupt the iteration. Add order is preserved by Set; insertion
    // order is what we want. Listeners are `{ id, fn }` tokens; call the fn.
    for (const token of Array.from(listeners)) {
      try { token.fn(id); } catch (e) { /* a faulty listener does not break the rest */ }
    }
  }

  function getSelection() { return currentId; }

  function setSelection(id) {
    if (id === currentId) return false;
    currentId = id == null ? null : String(id);
    fire(currentId);
    return true;
  }

  function clearSelection() { return setSelection(null); }

  function subscribe(fn) {
    if (typeof fn !== 'function') {
      throw new Error(`${SCENE_SELECTION_ERROR.INVALID_LISTENER}: listener must be a function`);
    }
    counter += 1;
    const token = { id: counter, fn };
    listeners.add(token);
    return function unsubscribe() {
      listeners.delete(token);
    };
  }

  function listenerCount() { return listeners.size; }

  return Object.freeze({
    getSelection,
    setSelection,
    clearSelection,
    subscribe,
    listenerCount,
  });
}

// Dual use: this file is loaded by both `node:test` (CommonJS, Node) and by
// editor.html's classic <script defer> (browser, no module system). The
// Node branch publishes `module.exports`; the browser branch publishes the
// same surface on `window.WRLForgeSceneSelection`. The same factory is used
// by both, so a regression in one is caught by both tests.
const api = Object.freeze({
  createSelectionController,
  SCENE_SELECTION_ERROR,
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.WRLForgeSceneSelection = api;
}