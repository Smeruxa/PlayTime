const { contextBridge, ipcRenderer } = require("electron")

const ALLOWED_SEND_CHANNELS = new Set([
    "notification-panel-height",
    "notification-clicked",
    "close-all-notifications",
    "notification-panel-clicked"
])

const ALLOWED_ON_CHANNELS = new Set(["set-notifications", "remove-notification"])

contextBridge.exposeInMainWorld("notifyAPI", {
    send: (channel, ...args) => {
        if (!ALLOWED_SEND_CHANNELS.has(channel)) return
        ipcRenderer.send(channel, ...args)
    },
    on: (channel, fn) => {
        if (!ALLOWED_ON_CHANNELS.has(channel)) return () => {}
        const wrapper = (_, ...a) => fn(...a)
        ipcRenderer.on(channel, wrapper)
        return () => ipcRenderer.removeListener(channel, wrapper)
    }
})
