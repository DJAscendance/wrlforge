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
});
