const { desktopCapturer, ipcMain } = require("electron")
const registeredSessions = new WeakSet()

function registerScreenCapture(session, getMainWindow) {
    if (registeredSessions.has(session)) return
    registeredSessions.add(session)
    let selectedSourceId = null
    ipcMain.handle("screen-share:select-source", async (event, sourceId) => {
        const mainWindow = getMainWindow()
        if (
            !mainWindow ||
            mainWindow.isDestroyed() ||
            event.sender !== mainWindow.webContents ||
            event.senderFrame !== mainWindow.webContents.mainFrame
        ) {
            throw new Error("Invalid screen capture sender")
        }
        selectedSourceId = null
        if (typeof sourceId !== "string") throw new Error("Invalid screen source")
        const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
        if (!sources.some((source) => source.id === sourceId)) throw new Error("Screen source no longer available")
        selectedSourceId = sourceId
    })

    session.setDisplayMediaRequestHandler(
        async (request, callback) => {
            const mainWindow = getMainWindow()
            const sourceId = selectedSourceId
            selectedSourceId = null
            if (
                !mainWindow ||
                mainWindow.isDestroyed() ||
                request.frame !== mainWindow.webContents.mainFrame ||
                !request.userGesture
            ) {
                callback(null)
                return
            }
            try {
                const sources = await desktopCapturer.getSources({
                    types: ["screen"],
                    thumbnailSize: { width: 0, height: 0 }
                })
                const source = sources.find((item) => item.id === sourceId)
                if (!source) {
                    callback(null)
                    return
                }
                callback({ video: source, ...(request.audioRequested ? { audio: "loopback" } : {}) })
            } catch {
                callback(null)
            }
        },
        { useSystemPicker: false }
    )
}

module.exports = { registerScreenCapture }
