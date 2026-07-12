'use strict';
// Mall lane file-open + explicit external-editor orchestration (Phase 7B1),
// extracted from main.js so the passive-launch posture is unit-testable without
// Electron. Every fs touch and the editor launch are injected.
//
// Posture (Phase 7B1): opening a Mall .wrl is PASSIVE. It prepares the plain
// `.edit.wrl` working copy that the in-app Re-check / Repack + external-editor
// round-trip reads, but it NEVER starts an external-editor process. An external
// editor launches ONLY through the explicit "Open in External Editor" action
// (openExternalEditor below). The native editor edits the real source directly
// and never touches the `.edit.wrl` working copy (see editor-controller.js).

// Open a Mall item passively: read + gzip-transparently decompress the source,
// write the plain `.edit.wrl` working copy, and return the load payload. Does NOT
// launch any external editor.
//
// deps:
//   readSource(mallPath)      -> { text, wasGzipped, rawBytes }
//   editPathFor(mallPath)     -> editFile absolute path
//   writeWorkingCopy(editFile, text)
function openMallItem(mallPath, deps) {
  const { text, wasGzipped, rawBytes } = deps.readSource(mallPath);
  const editFile = deps.editPathFor(mallPath);
  deps.writeWorkingCopy(editFile, text);
  return { mallPath, editFile, wasGzipped, rawBytes, text };
}

// Explicit "Open in External Editor": ensure the `.edit.wrl` working copy exists
// (create it from the mall source if missing -- e.g. it was deleted), then launch
// the external editor on it. This is the ONLY Mall-lane path that starts an
// external-editor process. Returns { editFile, editorStatus, created }.
//
// deps: readSource, writeWorkingCopy (as above) plus
//   workingCopyExists(editFile) -> boolean
//   launch(editFile)            -> editorStatus
function openExternalEditor({ mallPath, editFile }, deps) {
  let created = false;
  if (!deps.workingCopyExists(editFile)) {
    const { text } = deps.readSource(mallPath);
    deps.writeWorkingCopy(editFile, text);
    created = true;
  }
  return { editFile, editorStatus: deps.launch(editFile), created };
}

module.exports = { openMallItem, openExternalEditor };
