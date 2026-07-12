'use strict';
// Minimal, READ-ONLY bridge. Exposes exactly one function -- load a fixture's
// decompressed text + source base URL via the main process. No write path, no
// arbitrary path access (main.js confines names to fixtures/), no Node/fs
// handed to the renderer. contextIsolation stays on, nodeIntegration stays off.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wrlForge', {
  // name -> { text, wasGzipped, rawBytes, baseURL, sourcePath }
  loadFixture: (name) => ipcRenderer.invoke('wrl:load', name),
});
