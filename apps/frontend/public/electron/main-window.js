const fs = require("fs");
const { BrowserWindow, session, Menu, shell } = require("electron");
const paths = require("./paths");
const { registerScreenCapture } = require("./screen-capture");
const { protectNavigation } = require("./navigation-security");

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 960;
const MIN_HEIGHT = 600;

let mainWindow = null;

function getMainWindow() {
    return mainWindow;
}

function createMainWindow({ isDev }) {
    const iconPath = paths.faviconPath();
    const opts = {
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        center: true,
        autoHideMenuBar: true,
        frame: false,
        webPreferences: {
            preload: paths.mainPreloadPath(),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            media: true,
            devTools: isDev,
            backgroundThrottling: true
        }
    };
    if (fs.existsSync(iconPath)) opts.icon = iconPath;

    mainWindow = new BrowserWindow(opts);
    protectNavigation(mainWindow.webContents, (url) => shell.openExternal(url));
    registerScreenCapture(session.defaultSession, getMainWindow);

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const fromMainWindow = mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents;
        callback(!!fromMainWindow && (permission === "media" || permission === "display-capture"));
    });

    if (!isDev) {
        Menu.setApplicationMenu(null);
        mainWindow.setMenuBarVisibility(false);
        mainWindow.setAutoHideMenuBar(false);
        mainWindow.webContents.on("before-input-event", (event, input) => {
            if ((input.control || input.meta) && input.shift && input.key && input.key.toLowerCase() === "i")
                event.preventDefault();
            if (input.key === "Alt" || input.code === "AltLeft" || input.code === "AltRight") event.preventDefault();
        });
    }

    if (isDev) {
        mainWindow.loadURL("http://localhost:3000");
    } else {
        const indexPath = paths.productionIndexHtml();
        if (!fs.existsSync(indexPath)) {
            console.error("Missing build/index.html at:", indexPath);
            return;
        }
        mainWindow.loadFile(indexPath).catch((err) => {
            console.error("loadFile failed:", err);
        });
    }

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    const emitFocus = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const focused = mainWindow.isFocused() && !mainWindow.isMinimized();
        mainWindow.webContents.send("window:focus-changed", focused);
    };
    mainWindow.on("focus", emitFocus);
    mainWindow.on("blur", emitFocus);
    mainWindow.on("minimize", emitFocus);
    mainWindow.on("restore", emitFocus);
    mainWindow.on("show", emitFocus);
    mainWindow.webContents.on("did-finish-load", emitFocus);
}

module.exports = { getMainWindow, createMainWindow };
