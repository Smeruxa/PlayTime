const { app, autoUpdater: nativeUpdater, ipcMain, shell } = require("electron")
const semver = require("semver")
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const config = require("./config")
const { getMainWindow } = require("./main-window")
const { isMainWindowSender } = require("./ipc-security")

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://smeruxa.ru"
let state = { kind: "idle" }
let pendingVersion = null
let installTimer = null
let autoUpdater = null

function supportsAutomaticInstall() {
    if (process.platform !== "darwin") return false
    const bundle = path.resolve(path.dirname(process.execPath), "../..")
    const result = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", bundle], { encoding: "utf8" })
    return result.status === 0 && /^Authority=Developer ID Application:/m.test(result.stderr || "")
}

function log(phase, message = "") {
    try {
        const dir = app.getPath("logs")
        fs.mkdirSync(dir, { recursive: true })
        const file = path.join(dir, "updates.log")
        if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + ".old")
        fs.appendFileSync(file, `${new Date().toISOString()} ${phase} ${message}\n`, { mode: 0o600 })
    } catch {
        return
    }
}

function setState(next) {
    state = next
    log(next.kind, next.version || next.message || "")
    const w = getMainWindow()
    if (w && !w.isDestroyed()) w.webContents.send("update:state", next)
}

function fail(error) {
    clearTimeout(installTimer)
    installTimer = null
    const message = error instanceof Error ? error.message : String(error)
    log("error", message)
    setState({ kind: "error", version: pendingVersion, message })
    return { error: message }
}

async function checkWindowsRelease() {
    const response = await fetch(`${SITE_ORIGIN.replace(/\/$/, "")}/playtime/releases/latest`, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) throw new Error("Не удалось получить список релизов")
    const { releases } = await response.json()
    if (!releases || typeof releases !== "object") throw new Error("Некорректный список релизов")
    const release = releases.win32
    if (release && (release.platform !== "win32" || !semver.valid(release.version)))
        throw new Error("Некорректная версия Windows")
    pendingVersion = release && semver.gt(release.version, app.getVersion()) ? release.version : null
    setState(pendingVersion ? { kind: "manual", version: pendingVersion } : { kind: "idle" })
    return { ok: true, version: release?.version ?? null }
}

async function checkForUpdates() {
    if (config.isDev) return { skipped: true }
    try {
        if (process.platform === "win32") return await checkWindowsRelease()
        if (!autoUpdater) return { skipped: true }
        const result = await autoUpdater.checkForUpdates()
        return { ok: true, version: result?.updateInfo?.version ?? null }
    } catch (error) {
        return fail(error)
    }
}

function registerUpdateHandlers() {
    const authorize = (event) => {
        if (!isMainWindowSender(event)) throw new Error("Invalid update sender")
    }
    ipcMain.handle("update:state", (event) => {
        authorize(event)
        return state
    })
    ipcMain.handle("update:check", (event) => {
        authorize(event)
        return checkForUpdates()
    })
    ipcMain.handle("update:open-installer", async (event) => {
        authorize(event)
        try {
            await shell.openExternal(`${SITE_ORIGIN.replace(/\/$/, "")}/playtime/#download`)
            return { ok: true }
        } catch (error) {
            return fail(error)
        }
    })
    ipcMain.handle("update:install", (event) => {
        authorize(event)
        if (state.kind === "installing") return { ok: true }
        if (!autoUpdater || state.kind !== "downloaded") return { error: "Обновление ещё не готово к установке." }
        setState({ kind: "installing", version: state.version })
        try {
            installTimer = setTimeout(
                () => fail(new Error("Не удалось перезапустить приложение для обновления.")),
                30000
            )
            installTimer.unref?.()
            autoUpdater.quitAndInstall(false, true)
            return { ok: true }
        } catch (error) {
            return fail(error)
        }
    })
}

function initAutoUpdater() {
    registerUpdateHandlers()
    if (config.isDev) return
    setTimeout(checkForUpdates, 8000)
    setInterval(checkForUpdates, CHECK_INTERVAL_MS)
    if (process.platform !== "darwin") return

    autoUpdater = require("electron-updater").autoUpdater
    const automatic = supportsAutomaticInstall()
    log("init", automatic ? "automatic" : "manual-installer")
    autoUpdater.autoDownload = automatic
    autoUpdater.autoInstallOnAppQuit = automatic
    autoUpdater.setFeedURL({ provider: "generic", url: `${SITE_ORIGIN.replace(/\/$/, "")}/playtime/releases/feed/darwin` })

    autoUpdater.on("update-available", (info) => {
        pendingVersion = info.version
        setState({ kind: automatic ? "available" : "manual", version: info.version })
    })

    autoUpdater.on("update-not-available", () => {
        pendingVersion = null
        setState({ kind: "idle" })
    })

    autoUpdater.on("download-progress", (progress) => {
        if (state.kind === "available") setState({ ...state, percent: progress.percent })
    })

    autoUpdater.on("update-downloaded", (info) => {
        pendingVersion = info.version
        if (!automatic) return
        setState({ kind: "preparing", version: info.version })
    })
    if (automatic) {
        nativeUpdater.on("update-downloaded", () => {
            if (pendingVersion) setState({ kind: "downloaded", version: pendingVersion })
        })
    }
    autoUpdater.on("error", fail)
}

module.exports = { initAutoUpdater }
