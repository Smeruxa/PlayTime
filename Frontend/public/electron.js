const { app, BrowserWindow, session, ipcMain, Menu } = require("electron");
const path = require("path");

let debug = true;
let mainWindow;

ipcMain.handle("get-worklet-path", () => {
    return `${path.join(app.getAppPath(), "build", "recorder-worklet.js")}`;
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 600,
        minHeight: 400,
        autoHideMenuBar: true,
        icon: path.join(__dirname, "assets", "favicon.ico"),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            media: true,
            devTools: debug
        }
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === "media") callback(true);
        else callback(false);
    });

    if (!debug) {
        Menu.setApplicationMenu(null);
        mainWindow.setMenuBarVisibility(false);
        mainWindow.setAutoHideMenuBar(false);
        mainWindow.webContents.on("before-input-event", (event, input) => {
            if ((input.control || input.meta) && input.shift && input.key && input.key.toLowerCase() === "i") event.preventDefault();
            if (input.key === "Alt" || input.code === "AltLeft" || input.code === "AltRight") event.preventDefault();
        });
    }

    if (debug) {
        mainWindow.loadURL("http://localhost:3000");
    } else {
        const indexPath = path.join(app.getAppPath(), "build", "index.html");
        mainWindow.loadFile(indexPath);
    }

    mainWindow.on("closed", () => mainWindow = null);
}

app.on("ready", createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (mainWindow === null) createWindow(); });
