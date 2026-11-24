const path = require("node:path")
const { app, BrowserWindow, ipcMain, screen } = require("electron")
const paths = require("./paths")
const { getMainWindow } = require("./main-window")
const { isMainWindowSender, isNotificationPanelSender } = require("./ipc-security")

const NOTIFICATION_LIMIT = 5
const NOTIFICATION_TTL_MS = 5_000
const FADE_OUT_MS = 320
const PANEL_WIDTH = 340
const PANEL_MARGIN = 20
const MAX_PANEL_HEIGHT = 400
const MAX_NOTIFICATION_NAME_LEN = 120
const MAX_NOTIFICATION_TEXT_LEN = 500

let notificationPanel = null
let panelReady = false
let nextNotificationId = 0
let notifications = []
const notificationTimeouts = new Map()

function getNotificationPanel() {
    return notificationPanel && !notificationPanel.isDestroyed() ? notificationPanel : null
}

function getMaxPanelHeight({ workArea }) {
    return Math.max(1, Math.min(MAX_PANEL_HEIGHT, workArea.height - PANEL_MARGIN * 2))
}

function getPanelBounds(display, requestedHeight) {
    const { x, y, width } = display.workArea
    const panelWidth = Math.max(1, Math.min(PANEL_WIDTH, width - PANEL_MARGIN * 2))
    return {
        x: x + width - panelWidth - PANEL_MARGIN,
        y: y + PANEL_MARGIN,
        width: panelWidth,
        height: Math.max(1, Math.min(getMaxPanelHeight(display), requestedHeight))
    }
}

function sendNotifications() {
    const panel = getNotificationPanel()
    if (!panel || !panelReady) return
    const display = screen.getDisplayMatching(panel.getBounds())
    panel.webContents.send("set-notifications", notifications, getMaxPanelHeight(display))
}

function clearNotificationTimeout(id) {
    clearTimeout(notificationTimeouts.get(id))
    notificationTimeouts.delete(id)
}

function closeNotificationPanel() {
    const panel = getNotificationPanel()
    notificationPanel = null
    panelReady = false
    notifications = []
    notificationTimeouts.forEach((timeout) => clearTimeout(timeout))
    notificationTimeouts.clear()
    panel?.close()
}

function removeNotification(id) {
    clearNotificationTimeout(id)
    notifications = notifications.filter((notification) => notification.id !== id)
    if (notifications.length) sendNotifications()
    else closeNotificationPanel()
}

function focusMainWindow() {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return null
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    return mainWindow
}

function sanitizeNotificationData(data) {
    if (!data || typeof data !== "object") return null
    const name = typeof data.name === "string" ? data.name.slice(0, MAX_NOTIFICATION_NAME_LEN) : ""
    const text = typeof data.text === "string" ? data.text.slice(0, MAX_NOTIFICATION_TEXT_LEN) : ""
    if (!name && !text) return null
    return {
        name,
        text,
        peerUserId: Number.isSafeInteger(data.peerUserId) && data.peerUserId > 0 ? data.peerUserId : undefined,
        isRoom: !!data.isRoom,
        roomId: typeof data.roomId === "number" ? data.roomId : undefined,
        roomName: typeof data.roomName === "string" ? data.roomName.slice(0, MAX_NOTIFICATION_NAME_LEN) : undefined
    }
}

function createNotificationPanel(mainWindow) {
    const display = mainWindow.isFocused()
        ? screen.getDisplayMatching(mainWindow.getBounds())
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const panel = new BrowserWindow({
        ...getPanelBounds(display, 80),
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        acceptFirstMouse: true,
        show: false,
        webPreferences: {
            preload: paths.notifyPreloadPath(),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false
        }
    })
    notificationPanel = panel
    panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    panel.webContents.on("will-navigate", (event) => event.preventDefault())
    const closeWithMain = () => {
        if (notificationPanel === panel) closeNotificationPanel()
    }
    mainWindow.once("closed", closeWithMain)
    panel.on("closed", () => {
        mainWindow.removeListener("closed", closeWithMain)
        if (notificationPanel === panel) closeNotificationPanel()
    })
    panel.once("ready-to-show", () => {
        if (notificationPanel !== panel) return
        panelReady = true
        sendNotifications()
    })
    const html = app.isPackaged
        ? path.join(path.dirname(paths.productionIndexHtml()), "notify.html")
        : paths.notifyHtmlPath()
    panel.loadFile(html).catch((error) => {
        if (notificationPanel !== panel) return
        console.error("Failed to load PlayTime notifications", error)
        closeNotificationPanel()
    })
}

function isPanelSender(event) {
    return isNotificationPanelSender(event, getNotificationPanel) && event.senderFrame === event.sender.mainFrame
}

function registerNotificationHandlers() {
    ipcMain.on("show-notification", (event, data) => {
        if (!isMainWindowSender(event) || event.senderFrame !== event.sender.mainFrame) return
        const safeData = sanitizeNotificationData(data)
        if (!safeData) return
        const notification = { ...safeData, id: ++nextNotificationId, leaving: false }
        notifications.push(notification)
        if (notifications.length > NOTIFICATION_LIMIT) clearNotificationTimeout(notifications.shift().id)
        const { id } = notification
        const timeout = setTimeout(() => {
            notification.leaving = true
            if (panelReady) getNotificationPanel()?.webContents.send("remove-notification", id)
            notificationTimeouts.set(
                id,
                setTimeout(() => removeNotification(id), FADE_OUT_MS)
            )
        }, NOTIFICATION_TTL_MS)
        notificationTimeouts.set(id, timeout)

        if (!getNotificationPanel()) createNotificationPanel(getMainWindow())
        else sendNotifications()
    })

    ipcMain.on("notification-panel-height", (event, height) => {
        if (!isPanelSender(event) || !Number.isFinite(height) || height < 1) return
        const panel = getNotificationPanel()
        const display = screen.getDisplayMatching(panel.getBounds())
        panel.setBounds(getPanelBounds(display, Math.ceil(height)))
        if (!panel.isVisible()) panel.showInactive()
    })

    ipcMain.on("close-all-notifications", (event) => {
        if (isPanelSender(event)) closeNotificationPanel()
    })

    ipcMain.on("notification-panel-clicked", (event) => {
        if (isPanelSender(event)) focusMainWindow()
    })

    ipcMain.on("notification-clicked", (event, id) => {
        if (!isPanelSender(event)) return
        const notification = notifications.find((item) => item.id === id && !item.leaving)
        if (!notification) return
        const { name, text, isRoom, peerUserId, roomId, roomName } = notification
        focusMainWindow()?.webContents.send("open-content", { name, text, isRoom, peerUserId, roomId, roomName })
    })
}

module.exports = { registerNotificationHandlers }
