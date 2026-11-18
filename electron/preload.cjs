const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("studio", {
  loadWorkspace: (legacy) => ipcRenderer.invoke("workspace:load", legacy),
  saveWorkspace: (data) => ipcRenderer.invoke("workspace:save", data),
  exportFile: (data) => ipcRenderer.invoke("file:export", data),
  platform: process.platform,
});
