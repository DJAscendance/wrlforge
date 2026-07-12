'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vrmlpad', {
  openMall: () => ipcRenderer.invoke('mall:open'),
  openMallPath: (mallPath) => ipcRenderer.invoke('mall:openPath', mallPath),
  check: (editFile) => ipcRenderer.invoke('mall:check', editFile),
  repack: (mallPath, editFile, asGzip) => ipcRenderer.invoke('mall:repack', { mallPath, editFile, asGzip }),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:revealInFolder', filePath),
});
