const { getMainWindow } = require("./main-window");

function isMainWindowSender(event) {
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return false;
    return event.sender.id === main.webContents.id;
}

function isNotificationPanelSender(event, getNotificationPanel) {
    const panel = getNotificationPanel?.();
    if (!panel || panel.isDestroyed()) return false;
    return event.sender.id === panel.webContents.id;
}

module.exports = { isMainWindowSender, isNotificationPanelSender };
