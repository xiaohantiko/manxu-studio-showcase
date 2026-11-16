const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("studio", {
  exportFile: (data) => ipcRenderer.invoke("file:export", data),
  platform: process.platform,
});
