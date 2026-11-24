const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("incomingCallAPI", {
    onUpdate: (cb) => {
        const listener = (_event, call) => cb(call)
        ipcRenderer.on("incoming-call:update", listener)
        ipcRenderer.send("incoming-call:ready")
        return () => ipcRenderer.removeListener("incoming-call:update", listener)
    },
    answer: (answer) => ipcRenderer.send("incoming-call:answer", answer)
})
