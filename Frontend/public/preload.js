const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {});

contextBridge.exposeInMainWorld("electronAPI", {
    getWorkletPath: () => ipcRenderer.invoke("get-worklet-path")
});