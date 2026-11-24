const { pathToFileURL } = require("url");
const { ipcMain, desktopCapturer } = require("electron");
const paths = require("./paths");
const { getMainWindow } = require("./main-window");
const { isMainWindowSender } = require("./ipc-security");
const screenShareViewerWindow = require("./screen-share-viewer-window");
const { registerKeyVault } = require("./key-vault");

function registerMediaHandlers() {
    ipcMain.handle("get-worklet-path", () => {
        const workletPath = paths.recorderWorkletJs();
        return pathToFileURL(workletPath).href;
    });

    ipcMain.handle("get-screen-sources", async () => {
        const sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 320, height: 180 }
        });
        return sources.map((s) => ({
            id: s.id,
            name: s.name,
            thumbnail: s.thumbnail.toDataURL()
        }));
    });
}

function registerWindowControlHandlers() {
    ipcMain.on("call:active", (event, active) => {
        if (!isMainWindowSender(event) || typeof active !== "boolean") return;
        getMainWindow()?.webContents.setBackgroundThrottling(!active);
    });
    ipcMain.on("window:minimize", (event) => {
        if (!isMainWindowSender(event)) return;
        const w = getMainWindow();
        if (w) w.minimize();
    });

    ipcMain.on("window:maximize", (event) => {
        if (!isMainWindowSender(event)) return;
        const w = getMainWindow();
        if (!w) return;
        if (w.isMaximized()) w.unmaximize();
        else w.maximize();
    });

    ipcMain.on("window:close", (event) => {
        if (!isMainWindowSender(event)) return;
        const w = getMainWindow();
        if (w) w.close();
    });

    ipcMain.on("window:focus", (event) => {
        if (!isMainWindowSender(event)) return;
        const w = getMainWindow();
        if (!w) return;
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
    });

    ipcMain.handle("window:is-focused", () => {
        const w = getMainWindow();
        if (!w || w.isDestroyed()) return false;
        return w.isFocused() && !w.isMinimized();
    });
}

function registerAll() {
    registerKeyVault();
    registerMediaHandlers();
    registerWindowControlHandlers();
    screenShareViewerWindow.register(getMainWindow);
}

module.exports = { registerAll };
