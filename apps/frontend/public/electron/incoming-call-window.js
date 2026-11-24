const path = require("node:path")
const { app, BrowserWindow, ipcMain, screen } = require("electron")
const { getMainWindow } = require("./main-window")
const { protectNavigation } = require("./navigation-security")
const { publicRoot, productionIndexHtml } = require("./paths")

const WIDTH = 416
const HEIGHT = 277
const MAX_AVATAR_DATA_URL_CHARS = Math.ceil(25 * 1024 * 1.37) + 80
const MAX_BANNER_DATA_URL_CHARS = Math.ceil(200 * 1024 * 1.37) + 120
const MAX_TIMER_DELAY = 2 ** 31 - 1

function imageDataUrl(value, maxLength) {
    return typeof value === "string" &&
        value.length <= maxLength &&
        /^data:image\/(?:jpe?g|png|webp)(?:;[a-z0-9-]+=[^;,\r\n]*)*;base64,[a-z0-9+/\s]+=*$/i.test(value)
        ? value
        : null
}

function appearanceId(value) {
    return typeof value === "string" && /^[a-z0-9_]{1,32}$/.test(value) ? value : null
}

function normalizeCall(data) {
    if (!data || typeof data.roomId !== "string" || !data.roomId || data.roomId.length > 256) return null
    const from = typeof data.from === "string" ? data.from.slice(0, 120).trim() : ""
    if (!from) return null
    return {
        roomId: data.roomId,
        from,
        expiresAt: Number.isSafeInteger(data.expiresAt) ? data.expiresAt : undefined,
        avatar: imageDataUrl(data.avatar, MAX_AVATAR_DATA_URL_CHARS),
        profileBanner: imageDataUrl(data.profileBanner, MAX_BANNER_DATA_URL_CHARS),
        profileAvatarEffect: appearanceId(data.profileAvatarEffect),
        profileBannerEffect: appearanceId(data.profileBannerEffect),
        profileBannerSticker: appearanceId(data.profileBannerSticker),
        busy: data.busy === true,
        error: typeof data.error === "string" ? data.error.slice(0, 300).trim() || null : null
    }
}

function fromMainFrame(event, window) {
    return (
        window &&
        !window.isDestroyed() &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame
    )
}

function centeredBounds(main) {
    const { workArea } = main.isFocused()
        ? screen.getDisplayMatching(main.getBounds())
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    return {
        x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
        y: Math.round(workArea.y + (workArea.height - HEIGHT) / 2),
        width: WIDTH,
        height: HEIGHT
    }
}

function registerIncomingCallHandlers({ isDev }) {
    let popup = null

    const dispose = (opened) => {
        if (popup !== opened) return
        popup = null
        clearTimeout(opened.timeout)
        opened.owner.removeListener("closed", opened.close)
        opened.ownerContents.removeListener("render-process-gone", opened.close)
        opened.ownerContents.removeListener("did-start-navigation", opened.ownerNavigated)
    }

    const close = (opened) => {
        dispose(opened)
        if (!opened.window.isDestroyed()) opened.window.destroy()
    }

    const checkExpiry = (opened) => {
        clearTimeout(opened.timeout)
        if (opened.call.expiresAt === undefined) return
        const remaining = opened.call.expiresAt - Date.now()
        if (remaining <= 0) close(opened)
        else opened.timeout = setTimeout(() => checkExpiry(opened), Math.min(remaining, MAX_TIMER_DELAY))
    }

    const sendUpdate = (opened) => {
        if (popup !== opened || !opened.ready || opened.window.isDestroyed()) return
        opened.window.webContents.send("incoming-call:update", opened.call)
        if (!opened.window.isVisible()) opened.window.showInactive()
    }

    function open(owner, call) {
        const window = new BrowserWindow({
            ...centeredBounds(owner),
            title: "Входящий звонок — PlayTime",
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            closable: false,
            acceptFirstMouse: true,
            show: false,
            webPreferences: {
                preload: path.join(publicRoot(), "incoming-call-preload.js"),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                backgroundThrottling: false,
                devTools: isDev
            }
        })
        const opened = { window, owner, ownerContents: owner.webContents, call, ready: false }
        opened.close = () => close(opened)
        opened.ownerNavigated = ({ isMainFrame, isSameDocument }) => {
            if (isMainFrame && !isSameDocument) opened.close()
        }
        popup = opened
        owner.once("closed", opened.close)
        opened.ownerContents.once("render-process-gone", opened.close)
        opened.ownerContents.on("did-start-navigation", opened.ownerNavigated)
        window.on("closed", () => dispose(opened))
        window.webContents.once("render-process-gone", opened.close)
        protectNavigation(window.webContents, () => {})
        const load = isDev
            ? window.loadURL("http://localhost:3000/incoming-call.html")
            : window.loadFile(path.join(path.dirname(productionIndexHtml()), "incoming-call.html"))
        void load.catch(opened.close)
        return opened
    }

    ipcMain.on("incoming-call:show", (event, data) => {
        const main = getMainWindow()
        if (!fromMainFrame(event, main)) return
        const call = normalizeCall(data)
        if (!call || (call.expiresAt !== undefined && call.expiresAt <= Date.now())) return
        if (popup && (popup.owner !== main || popup.call.roomId !== call.roomId)) close(popup)
        const opened = popup ?? open(main, call)
        opened.call = call
        checkExpiry(opened)
        sendUpdate(opened)
    })

    ipcMain.on("incoming-call:hide", (event, roomId) => {
        if (!popup || !fromMainFrame(event, popup.owner)) return
        if (roomId === undefined || roomId === popup.call.roomId) close(popup)
    })

    ipcMain.on("incoming-call:ready", (event) => {
        if (!popup || !fromMainFrame(event, popup.window)) return
        popup.ready = true
        sendUpdate(popup)
    })

    ipcMain.on("incoming-call:answer", (event, answer) => {
        if (!popup || !fromMainFrame(event, popup.window) || !popup.ready || popup.call.busy) return
        if (answer?.roomId !== popup.call.roomId || typeof answer.accept !== "boolean") return
        if (popup.call.expiresAt !== undefined && popup.call.expiresAt <= Date.now()) {
            close(popup)
            return
        }
        popup.call = { ...popup.call, busy: true, error: null }
        sendUpdate(popup)
        popup.ownerContents.send("incoming-call:answer", { roomId: answer.roomId, accept: answer.accept })
    })

    app.on("before-quit", () => {
        if (popup) close(popup)
    })
}

module.exports = { registerIncomingCallHandlers }
