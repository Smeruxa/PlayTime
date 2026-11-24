const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { EventEmitter } = require("node:events")

function fixture({ platform = "darwin", signed = true, isDev = false, windowsRelease, version = "2.0.20" } = {}) {
    const updater = new EventEmitter()
    const native = new EventEmitter()
    const ipc = new Map()
    const events = []
    const opened = []
    const timers = []
    const requests = []
    let updaterLoads = 0
    let installs = 0
    updater.setFeedURL = () => {}
    updater.checkForUpdates = async () => ({ updateInfo: { version: "2.0.12" } })
    updater.quitAndInstall = () => {
        installs++
    }
    const module = { exports: {} }
    const main = { isDestroyed: () => false, webContents: { send: (_channel, value) => events.push(value) } }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../apps/frontend/public/electron/update.js"), "utf8"), {
        module,
        AbortSignal,
        fetch: async (url, options) => {
            requests.push({ url, options })
            return { ok: true, json: async () => ({ releases: { win32: windowsRelease } }) }
        },
        process: { platform, execPath: "/Applications/PlayTime.app/Contents/MacOS/PlayTime", env: {} },
        setTimeout: (fn, ms) => {
            const timer = { fn, ms, cancelled: false, unref() {} }
            timers.push(timer)
            return timer
        },
        clearTimeout: (timer) => {
            if (timer) timer.cancelled = true
        },
        setInterval: () => {},
        require: (name) => {
            if (name === "electron-updater") {
                updaterLoads++
                return { autoUpdater: updater }
            }
            if (name === "electron")
                return {
                    autoUpdater: native,
                    app: {
                        getVersion: () => version,
                        getPath: () => {
                            throw new Error("no logs in fixture")
                        }
                    },
                    ipcMain: { handle: (name, fn) => ipc.set(name, fn) },
                    shell: { openExternal: async (url) => opened.push(url) }
                }
            if (name === "node:child_process")
                return {
                    spawnSync: () => ({
                        status: 0,
                        stderr: signed ? "Authority=Developer ID Application: Test\n" : "Signature=adhoc\n"
                    })
                }
            if (name === "./config") return { isDev }
            if (name === "./main-window") return { getMainWindow: () => main }
            if (name === "./ipc-security") return { isMainWindowSender: (event) => event.trusted === true }
            return require(name)
        }
    })
    module.exports.initAutoUpdater()
    return {
        updater,
        native,
        events,
        opened,
        requests,
        updaterLoads: () => updaterLoads,
        timers,
        ipc,
        state: () => events.at(-1),
        installs: () => installs,
        invoke: (channel, ...args) => ipc.get(channel)({ trusted: true }, ...args)
    }
}

test("macOS waits for Squirrel validation before enabling restart", () => {
    const f = fixture()
    f.updater.emit("update-available", { version: "2.0.12" })
    f.updater.emit("update-downloaded", { version: "2.0.12" })
    assert.equal(f.state().kind, "preparing")
    assert.match(f.invoke("update:install").error, /не готово/)
    assert.equal(f.installs(), 0)
    f.native.emit("update-downloaded")
    assert.equal(f.state().kind, "downloaded")
    assert.equal(f.invoke("update:install").ok, true)
    assert.equal(f.state().kind, "installing")
    f.invoke("update:install")
    assert.equal(f.installs(), 1)
})

test("ad-hoc macOS builds offer an installer instead of a broken restart", async () => {
    const f = fixture({ signed: false })
    assert.equal(f.updater.autoDownload, false)
    assert.equal(f.updater.autoInstallOnAppQuit, false)
    f.updater.emit("update-available", { version: "2.0.12" })
    assert.equal(f.state().kind, "manual")
    assert.equal(f.invoke("update:install").ok, undefined)
    await f.invoke("update:open-installer", "file:///untrusted")
    assert.deepEqual(f.opened, ["https://smeruxa.ru/playtime/#download"])
    assert.equal(f.installs(), 0)
})

test("signature rejection clears the premature downloaded state and remains visible", () => {
    const f = fixture()
    f.updater.emit("update-downloaded", { version: "2.0.12" })
    f.updater.emit("error", new Error("SQRLCodeSignatureErrorDomain"))
    assert.equal(f.state().kind, "error")
    assert.equal(f.state().version, "2.0.12")
    assert.match(f.state().message, /SQRLCodeSignatureErrorDomain/)
    f.invoke("update:install")
    assert.equal(f.installs(), 0)
})

test("a silent macOS restart failure becomes an actionable error", () => {
    const f = fixture()
    f.updater.emit("update-downloaded", { version: "2.0.12" })
    f.native.emit("update-downloaded")
    f.invoke("update:install")
    f.timers.find((timer) => timer.ms === 30000).fn()
    assert.equal(f.state().kind, "error")
    assert.match(f.state().message, /перезапустить/)
})

test("a macOS install failure is reported", () => {
    const f = fixture()
    f.updater.emit("update-downloaded", { version: "2.0.12" })
    f.native.emit("update-downloaded")
    assert.equal(f.state().kind, "downloaded")
    f.updater.quitAndInstall = () => {
        throw new Error("cannot install")
    }
    assert.match(f.invoke("update:install").error, /cannot install/)
    assert.equal(f.state().kind, "error")
    assert.equal(f.timers.find((timer) => timer.ms === 30000).cancelled, true)
})

test("Windows checks release metadata, offers the PlayTime site and never loads the native updater", async () => {
    const windowsRelease = { platform: "win32", version: "2.0.100", url: "https://example.test/download.exe" }
    const f = fixture({ platform: "win32", windowsRelease })
    await f.invoke("update:check")
    assert.equal(f.requests.length, 1)
    assert.equal(f.requests[0].url, "https://smeruxa.ru/playtime/releases/latest")
    assert.equal(f.requests[0].options.redirect, "error")
    assert.equal(f.state().kind, "manual")
    assert.equal(f.state().version, "2.0.100")
    await f.invoke("update:open-installer", windowsRelease.url)
    assert.deepEqual(f.opened, ["https://smeruxa.ru/playtime/#download"])
    f.updater.emit("update-downloaded", windowsRelease)
    assert.equal(f.invoke("update:install").ok, undefined)
    assert.equal(f.installs(), 0)
    assert.equal(f.updaterLoads(), 0)
})

test("Windows treats equal, older and missing releases as idle and rejects malformed versions", async () => {
    for (const version of ["2.0.20", "2.0.9", undefined]) {
        const windowsRelease = version ? { platform: "win32", version } : undefined
        const f = fixture({ platform: "win32", windowsRelease })
        await f.invoke("update:check")
        assert.equal(f.state().kind, "idle")
    }
    const f = fixture({ platform: "win32", windowsRelease: { platform: "win32", version: "invalid" } })
    await f.invoke("update:check")
    assert.equal(f.state().kind, "error")
    assert.equal(f.installs(), 0)
})

test("reopened windows can recover state and foreign IPC cannot install or open URLs", () => {
    const f = fixture()
    f.updater.emit("update-available", { version: "2.0.12" })
    assert.equal(f.invoke("update:state").version, "2.0.12")
    for (const channel of ["update:state", "update:check", "update:install"])
        assert.throws(() => f.ipc.get(channel)({ trusted: false }), /Invalid update sender/)
    assert.equal(f.opened.length, 0)
    assert.equal(f.installs(), 0)
})

test("development windows can read idle status without starting the production updater", async () => {
    const f = fixture({ isDev: true })
    assert.equal(f.invoke("update:state").kind, "idle")
    assert.equal((await f.invoke("update:check")).skipped, true)
    assert.equal(f.updater.listenerCount("update-available"), 0)
})
