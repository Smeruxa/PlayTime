const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");
const { mixerState, mixerChange } = require("./screen-viewer-mixer");

let viewerWin = null;
let viewerDisplayId = null;
let currentMixer = null;

function register(getMainWindow) {
    const openOnMainDisplay = () => {
        const { screen } = require("electron");
        const main = getMainWindow();
        if (!main || main.isDestroyed()) return { ok: false };
        const display = screen.getDisplayMatching(main.getBounds());
        if (viewerWin && !viewerWin.isDestroyed()) {
            if (viewerDisplayId === display.id) {
                viewerWin.focus();
                return { ok: true, already: true };
            }
            const previous = viewerWin;
            viewerWin = null;
            previous.close();
        }
        const root = paths.publicRoot();
        const iconPath = paths.faviconPath();
        const win = new BrowserWindow({
            ...display.bounds,
            fullscreen: false,
            frame: false,
            backgroundColor: "#000000",
            autoHideMenuBar: true,
            show: false,
            ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
            webPreferences: {
                preload: path.join(root, "screen-share-viewer-preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                backgroundThrottling: false
            }
        });
        viewerWin = win;
        viewerDisplayId = display.id;
        win.setMenuBarVisibility(false);
        win.webContents.on("did-finish-load", () => {
            if (!win.isDestroyed()) win.webContents.send("screen-share-viewer-mixer", currentMixer);
        });
        win.once("ready-to-show", () => {
            if (win.isDestroyed() || viewerWin !== win) return;
            const currentMain = getMainWindow();
            const currentDisplay = currentMain && !currentMain.isDestroyed()
                ? screen.getDisplayMatching(currentMain.getBounds()) : screen.getPrimaryDisplay();
            viewerDisplayId = currentDisplay.id;
            win.setBounds(currentDisplay.bounds);
            win.show();
            if (process.platform === "darwin") win.setSimpleFullScreen(true);
            else win.setFullScreen(true);
        });
        win.on("closed", () => {
            if (viewerWin !== win) return;
            viewerWin = null;
            viewerDisplayId = null;
            const main = getMainWindow();
            if (main && !main.isDestroyed()) {
                try { main.webContents.send("screen-share-viewer-closed"); }
                catch { return; }
            }
        });
        win.loadFile(path.join(root, "screen-share-viewer.html"));
        return { ok: true };
    };
    ipcMain.handle("screen-share-viewer:open", async (event) => {
        const main = getMainWindow();
        if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) return { ok: false };
        return openOnMainDisplay();
    });
    app.whenReady().then(() => {
        const { screen } = require("electron");
        screen.on("display-removed", (_event, display) => {
            if (viewerWin && !viewerWin.isDestroyed() && viewerDisplayId === display.id) {
                viewerDisplayId = null;
                openOnMainDisplay();
            }
        });
    });

    ipcMain.on("screen-share-viewer:mixer-state", (event, value) => {
        const main = getMainWindow();
        if (!main || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) return;
        const state = mixerState(value);
        if (!state && value !== null) return;
        currentMixer = state;
        if (viewerWin && !viewerWin.isDestroyed()) viewerWin.webContents.send("screen-share-viewer-mixer", state);
    });
    ipcMain.on("screen-share-viewer:mixer-request", (event) => {
        if (!viewerWin || viewerWin.isDestroyed() || event.sender !== viewerWin.webContents || event.senderFrame !== viewerWin.webContents.mainFrame) return;
        viewerWin.webContents.send("screen-share-viewer-mixer", currentMixer);
    });
    ipcMain.on("screen-share-viewer:mixer-change", (event, value) => {
        if (!viewerWin || viewerWin.isDestroyed() || event.sender !== viewerWin.webContents || event.senderFrame !== viewerWin.webContents.mainFrame) return;
        const change = mixerChange(value, currentMixer);
        const main = getMainWindow();
        if (change && main && !main.isDestroyed()) main.webContents.send("screen-share-viewer-mixer-change", change);
    });

    ipcMain.on("screen-share-viewer:frame", (event, dataUrl) => {
        const main = getMainWindow();
        if (!main || event.sender.id !== main.webContents.id) return;
        if (!viewerWin || viewerWin.isDestroyed()) return;
        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return;
        try {
            viewerWin.webContents.send("screen-share-viewer-frame", dataUrl);
        } catch {
            return;
        }
    });

    ipcMain.on("screen-share-viewer:close-from-viewer", (event) => {
        if (!viewerWin || viewerWin.isDestroyed()) return;
        if (event.sender.id !== viewerWin.webContents.id) return;
        viewerWin.close();
    });

    ipcMain.on("screen-share-viewer:close-request", (event) => {
        const main = getMainWindow();
        if (!main || event.sender.id !== main.webContents.id) return;
        if (viewerWin && !viewerWin.isDestroyed()) viewerWin.close();
    });
}

module.exports = { register };
