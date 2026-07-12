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
});
