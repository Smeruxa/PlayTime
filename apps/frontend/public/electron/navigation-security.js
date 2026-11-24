function externalUrl(raw) {
    try {
        const url = new URL(raw)
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null
    } catch {
        return null
    }
}

function protectNavigation(webContents, openExternal) {
    const open = (url) => {
        const safe = externalUrl(url)
        if (safe) Promise.resolve(openExternal(safe)).catch(() => {})
    }
    webContents.setWindowOpenHandler(({ url }) => {
        open(url)
        return { action: "deny" }
    })
    webContents.on("will-navigate", (event, url) => {
        event.preventDefault()
        open(url)
    })
    webContents.on("will-frame-navigate", (event) => event.preventDefault())
    webContents.on("will-attach-webview", (event) => event.preventDefault())
}

module.exports = { externalUrl, protectNavigation }
