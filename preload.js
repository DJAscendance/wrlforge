'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vrmlpad', {
  openMall: () => ipcRenderer.invoke('mall:open'),
  openMallPath: (mallPath) => ipcRenderer.invoke('mall:openPath', mallPath),
  check: (editFile) => ipcRenderer.invoke('mall:check', editFile),
  repack: (mallPath, editFile, asGzip) => ipcRenderer.invoke('mall:repack', { mallPath, editFile, asGzip }),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:revealInFolder', filePath),
  // Embedded X_ITE preview (Phase 2B1): read-only source load + explicit editor
  // launch. loadPreview reads only the currently-open item/edit file (role), not
  // an arbitrary path. No write-capable preview channel is exposed.
  loadPreview: (role) => ipcRenderer.invoke('preview:load', role),
  openInEditor: () => ipcRenderer.invoke('mall:openInEditor'),
  // Navigate the single window between the Mall and World workspaces. The page
  // name is whitelisted in the main process; the renderer cannot navigate to an
  // arbitrary URL.
  goto: (page) => ipcRenderer.invoke('app:goto', page),
  // World Project lane (Phase 4A) -- strictly READ-ONLY. No method mutates,
  // repairs, copies, renames, deletes, uploads, or fetches. The main process
  // owns all project paths; scanProject/refresh act only on the open project.
  world: {
    openFolder: () => ipcRenderer.invoke('world:openFolder'),
    openPrimaryFile: () => ipcRenderer.invoke('world:openPrimaryFile'),
    choosePrimary: (primaryPath) => ipcRenderer.invoke('world:choosePrimary', primaryPath),
    scanProject: () => ipcRenderer.invoke('world:scan'),
    refreshProject: () => ipcRenderer.invoke('world:refresh'),
    // Read-only embedded X_ITE preview loader (Phase 4B): returns decompressed
    // primary text + the wrlworld base URL + advisory counts/warnings. Takes no
    // path; the main process authorizes nested reads from the asset graph.
    loadPreview: () => ipcRenderer.invoke('world:previewLoad'),
    describe: () => ipcRenderer.invoke('world:describe'),
    reveal: (targetPath) => ipcRenderer.invoke('world:reveal', targetPath),
    revealRoot: () => ipcRenderer.invoke('world:revealRoot'),
    openPrimaryInEditor: () => ipcRenderer.invoke('world:openPrimaryInEditor'),
    // Read-only packaging AUDIT (Phase 5A): what a portable review bundle would
    // contain (status/totals/blocking/unused/manifest). Analysis only — no write.
    packageAudit: () => ipcRenderer.invoke('world:packageAudit'),
    // Explicit BUILD REVIEW BUNDLE action (Phase 5A): the main process prompts for
    // a destination outside the project and writes a deterministic ZIP. Not upload.
    buildReviewBundle: () => ipcRenderer.invoke('world:buildReviewBundle'),
  },
  // Native editor lane (Phase 7B). The main process owns the open document and
  // every path: these methods carry text + intent + an opaque sessionId, never a
  // renderer-chosen write path. openWorldReference names a file to READ, which
  // main authorizes against the World scan graph. Save writes only to the held
  // source; saveAs writes only to a path main obtains from its own dialog.
  editor: {
    openMall: () => ipcRenderer.invoke('editor:openMall'),
    openWorldPrimary: () => ipcRenderer.invoke('editor:openWorldPrimary'),
    openWorldReference: (ref) => ipcRenderer.invoke('editor:openWorldReference', ref),
    describe: (opts) => ipcRenderer.invoke('editor:describe', opts),
    setText: (sessionId, text) => ipcRenderer.invoke('editor:setText', { sessionId, text }),
    save: (sessionId, text, allowOverwrite) => ipcRenderer.invoke('editor:save', { sessionId, text, allowOverwrite }),
    saveAs: (sessionId, text, format) => ipcRenderer.invoke('editor:saveAs', { sessionId, text, format }),
    reload: (sessionId) => ipcRenderer.invoke('editor:reload', { sessionId }),
    checkConflict: (sessionId) => ipcRenderer.invoke('editor:checkConflict', { sessionId }),
    openInExternal: (sessionId) => ipcRenderer.invoke('editor:openInExternal', { sessionId }),
    close: (sessionId) => ipcRenderer.invoke('editor:close', { sessionId }),
    restore: () => ipcRenderer.invoke('editor:restore'),
    // Live in-editor preview (Phase 7C2 Mall + Phase 7C3 World). The renderer
    // sends only the opaque sessionId + buffer text + monotonic bufferVersion
    // (never a path): main routes to the open document's profile bridge, which
    // authorizes the session against its own authority (the held Mall source,
    // or the World scan graph), byte-substitutes the unsaved buffer through the
    // overlay, and returns the render payload. saved renders entirely from
    // disk; accept confirms a generation; rescan is the explicit World
    // "Find new files" action (main reruns its own scan -- no path crosses);
    // close/leak are cleanup + the QA leak assertion. No write path is exposed.
    previewLoad: (sessionId, text, bufferVersion) => ipcRenderer.invoke('editor:previewLoad', { sessionId, text, bufferVersion }),
    previewSaved: (sessionId) => ipcRenderer.invoke('editor:previewSaved', { sessionId }),
    previewAccept: (sessionId, generation) => ipcRenderer.invoke('editor:previewAccept', { sessionId, generation }),
    previewRescan: (sessionId) => ipcRenderer.invoke('editor:previewRescan', { sessionId }),
    previewClose: (sessionId) => ipcRenderer.invoke('editor:previewClose', { sessionId }),
    previewLeak: () => ipcRenderer.invoke('editor:previewLeak'),
    // Phase Beta 2 -- crash recovery. The renderer pings recordDirty (throttled
    // on its end) on every keystroke; main debounces the writes to userData.
    // readAdopt performs a Restore; clear is the Start Fresh / Discard path.
    // No path is renderer-supplied.
    recoveryRead: () => ipcRenderer.invoke('editor:recoveryRead'),
    recoveryRecordDirty: (payload) => ipcRenderer.invoke('editor:recoveryRecordDirty', payload),
    recoveryAdopt: () => ipcRenderer.invoke('editor:recoveryAdopt'),
    recoveryClear: () => ipcRenderer.invoke('editor:recoveryClear'),
    recoveryActiveWorkspace: () => ipcRenderer.invoke('editor:recoveryActiveWorkspace'),
  },
});
