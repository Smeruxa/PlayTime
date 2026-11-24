const { app } = require("electron")
const config = require("./electron/config")
const { createMainWindow, getMainWindow } = require("./electron/main-window")
const ipcHandlers = require("./electron/ipc-handlers")
const { registerNotificationHandlers } = require("./electron/notifications")
const { registerIncomingCallHandlers } = require("./electron/incoming-call-window")
const { initAutoUpdater } = require("./electron/update")
const processErrors = require("./electron/process-errors")

ipcHandlers.registerAll()
registerNotificationHandlers()
registerIncomingCallHandlers(config)
processErrors.register()

app.on("ready", () => {
    createMainWindow(config)
    initAutoUpdater()
})

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
    if (getMainWindow() === null) createMainWindow(config)
})
