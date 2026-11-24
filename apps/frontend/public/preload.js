const { contextBridge, ipcRenderer } = require("electron")

const ALLOWED_RENDERER_ON_CHANNELS = new Set(["open-content"])

window.addEventListener("DOMContentLoaded", () => {})

contextBridge.exposeInMainWorld("electronAPI", {
    setCallActive: (active) => ipcRenderer.send("call:active", active),
    readEncryptionKeys: (userId) => ipcRenderer.invoke("keys:read", userId),
    writeEncryptionKeys: (userId, keys) => ipcRenderer.invoke("keys:write", userId, keys),
    getWorkletPath: () => ipcRenderer.invoke("get-worklet-path"),
    getScreenSources: () => ipcRenderer.invoke("get-screen-sources"),
    selectScreenSource: (sourceId) => ipcRenderer.invoke("screen-share:select-source", sourceId),
    screenShareViewerOpen: () => ipcRenderer.invoke("screen-share-viewer:open"),
    screenShareViewerSendFrame: (dataUrl) => ipcRenderer.send("screen-share-viewer:frame", dataUrl),
    screenShareViewerSetMixer: (state) => ipcRenderer.send("screen-share-viewer:mixer-state", state),
    screenShareViewerOnMixerChange: (cb) => {
        const listener = (_event, change) => cb(change)
        ipcRenderer.on("screen-share-viewer-mixer-change", listener)
        return () => ipcRenderer.removeListener("screen-share-viewer-mixer-change", listener)
    },
    screenShareViewerClose: () => ipcRenderer.send("screen-share-viewer:close-request"),
    screenShareViewerSubscribeClosed: (cb) => {
        const fn = () => cb()
        ipcRenderer.on("screen-share-viewer-closed", fn)
        return () => ipcRenderer.removeListener("screen-share-viewer-closed", fn)
    },
    sendNotification: (data) => ipcRenderer.send("show-notification", data),
    showIncomingCall: (call) => ipcRenderer.send("incoming-call:show", call),
    hideIncomingCall: (roomId) => ipcRenderer.send("incoming-call:hide", roomId),
    onIncomingCallAnswer: (cb) => {
        const listener = (_event, answer) => cb(answer)
        ipcRenderer.on("incoming-call:answer", listener)
        return () => ipcRenderer.removeListener("incoming-call:answer", listener)
    },
    isWindowFocused: () => ipcRenderer.invoke("window:is-focused"),
    onWindowFocusChanged: (cb) => {
        const fn = (_e, focused) => cb(!!focused)
        ipcRenderer.on("window:focus-changed", fn)
        return () => ipcRenderer.removeListener("window:focus-changed", fn)
    },
    checkForUpdates: () => ipcRenderer.invoke("update:check"),
    installUpdate: () => ipcRenderer.invoke("update:install"),
    getUpdateState: () => ipcRenderer.invoke("update:state"),
    openUpdateDownload: () => ipcRenderer.invoke("update:open-installer"),
    onUpdateEvent: (cb) => {
        const channels = [
            "update:state",
            "update:available",
            "update:not-available",
            "update:progress",
            "update:downloaded",
            "update:error"
        ]
        const handlers = channels.map((ch) => {
            const fn = (_e, payload) => cb(ch, payload)
            ipcRenderer.on(ch, fn)
            return { ch, fn }
        })
        return () => {
            for (const { ch, fn } of handlers) ipcRenderer.removeListener(ch, fn)
        }
    },
    on: (channel, func) => {
        if (!ALLOWED_RENDERER_ON_CHANNELS.has(channel)) return
        ipcRenderer.on(channel, func)
    },
    off: (channel, func) => {
        if (!ALLOWED_RENDERER_ON_CHANNELS.has(channel)) return
        ipcRenderer.removeListener(channel, func)
    }
})

contextBridge.exposeInMainWorld("windowControls", {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    focus: () => ipcRenderer.send("window:focus")
})
