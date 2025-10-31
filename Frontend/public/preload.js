const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {});

contextBridge.exposeInMainWorld("electronAPI", {
    getWorkletPath: () => ipcRenderer.invoke("get-worklet-path"),
    sendNotification: (data) => ipcRenderer.send("show-notification", data),
    on: (channel, func) => ipcRenderer.on(channel, func),
    off: (channel, func) => ipcRenderer.removeListener(channel, func)
});

contextBridge.exposeInMainWorld("windowControls", {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close")
})