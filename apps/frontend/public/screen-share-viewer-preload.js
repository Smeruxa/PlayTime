const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("screenShareViewer", {
    onMixer: (cb) => {
        const listener = (_event, state) => cb(state)
        ipcRenderer.on("screen-share-viewer-mixer", listener)
        return () => ipcRenderer.removeListener("screen-share-viewer-mixer", listener)
    },
    requestMixer: () => ipcRenderer.send("screen-share-viewer:mixer-request"),
    changeMixer: (change) => ipcRenderer.send("screen-share-viewer:mixer-change", change),
    onFrame: (cb) => {
        ipcRenderer.removeAllListeners("screen-share-viewer-frame")
        ipcRenderer.on("screen-share-viewer-frame", (_e, url) => {
            if (typeof url === "string") cb(url)
        })
    },
    close: () => ipcRenderer.send("screen-share-viewer:close-from-viewer")
})
