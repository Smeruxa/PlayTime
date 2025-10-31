const { app, BrowserWindow, session, ipcMain, Menu, screen } = require("electron");
const path = require("path");

let debug = false;
let mainWindow;
let activeNotifications = [];

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
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            media: true,
            devTools: debug
        }
    });

    session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
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

ipcMain.on("window:minimize", () => { if (mainWindow) mainWindow.minimize(); });

ipcMain.on("window:maximize", () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    }
});

ipcMain.on("window:close", () => { if (mainWindow) mainWindow.close(); });

ipcMain.on("show-notification", async (_, data) => {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
    const margin = 10
    const maxVisible = 5

    if (activeNotifications.length >= maxVisible) {
        const oldest = activeNotifications.shift()
        if (!oldest.isDestroyed()) oldest.close()
    }

    activeNotifications.forEach(win => {
        const bounds = win.getBounds()
        win.setBounds({ x: bounds.x, y: bounds.y + bounds.height + margin, width: bounds.width, height: bounds.height })
    })

    const notifyWindow = new BrowserWindow({
        width: 320,
        height: 1,
        x: screenWidth - 340,
        y: margin,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        focusable: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    })

    const indexPath = debug
        ? path.join(app.getAppPath(), "public", "notify.html")
        : path.join(app.getAppPath(), "build", "notify.html")

    notifyWindow.loadFile(indexPath)
    notifyWindow.once("ready-to-show", async () => {
        notifyWindow.webContents.send("push-notification", data)
        const contentHeight = await notifyWindow.webContents.executeJavaScript(
            "document.getElementById('note').scrollHeight"
        )
        const bounds = notifyWindow.getBounds()
        notifyWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: contentHeight })
    })

    notifyWindow.on("click", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
    })

    activeNotifications.push(notifyWindow)

    setTimeout(() => {
        const idx = activeNotifications.indexOf(notifyWindow)
        if (idx > -1) activeNotifications.splice(idx, 1)
        if (!notifyWindow.isDestroyed()) notifyWindow.close()
    }, 5500)
})

ipcMain.on("close-all-notifications", () => {
    activeNotifications.forEach(win => {
        if (!win.isDestroyed()) win.close()
    })
    activeNotifications = []
})

ipcMain.on("notification-clicked", (_event, data) => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
        mainWindow.webContents.send("open-content", { name: data.name })
    }
})

app.on("ready", createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (mainWindow === null) createWindow(); });
