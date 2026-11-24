const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const path = require("node:path")
const { EventEmitter } = require("node:events")
function fixture(platform = "win32") {
    const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    const secondary = { id: 2, bounds: { x: -2560, y: -100, width: 2560, height: 1440 } }
    let mainBounds = { x: -2400, y: 100, width: 1280, height: 800 }
    let displays = [primary, secondary]
    const windows = [],
        handlers = new Map(),
        screen = new EventEmitter()
    const main = {
        isDestroyed: () => false,
        getBounds: () => mainBounds,
        webContents: { id: 7, mainFrame: {}, send() {} }
    }
    screen.getPrimaryDisplay = () => primary
    screen.getDisplayMatching = (bounds) =>
        displays.reduce((best, display) => {
            const intersection = (d) =>
                Math.max(
                    0,
                    Math.min(bounds.x + bounds.width, d.bounds.x + d.bounds.width) - Math.max(bounds.x, d.bounds.x)
                ) *
                Math.max(
                    0,
                    Math.min(bounds.y + bounds.height, d.bounds.y + d.bounds.height) - Math.max(bounds.y, d.bounds.y)
                )
            return intersection(display) > intersection(best) ? display : best
        })
    class Window extends EventEmitter {
        constructor(options) {
            super()
            this.options = options
            this.calls = []
            this.destroyed = false
            this.webContents = new EventEmitter()
            this.webContents.send = () => {}
            this.webContents.mainFrame = {}
            windows.push(this)
        }
        isDestroyed() {
            return this.destroyed
        }
        focus() {
            this.calls.push(["focus"])
        }
        setMenuBarVisibility() {}
        loadFile() {}
        setBounds(bounds) {
            this.calls.push(["bounds", bounds])
        }
        show() {
            this.calls.push(["show"])
        }
        setFullScreen(value) {
            this.calls.push(["fullscreen", value])
        }
        setSimpleFullScreen(value) {
            this.calls.push(["simple-fullscreen", value])
        }
        close() {
            this.destroyed = true
            this.emit("closed")
        }
    }
    const module = { exports: {} }
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, "../../apps/frontend/public/electron/screen-share-viewer-window.js"), "utf8"),
        {
            module,
            process: { platform },
            require: (name) =>
                name === "electron"
                    ? {
                          app:{whenReady:()=>Promise.resolve()}, BrowserWindow: Window,
                          ipcMain: { handle: (n, f) => handlers.set(n, f), on: (n, f) => handlers.set(n, f) },
                          screen
                      }
                    : name === "./paths"
                      ? { publicRoot: () => "/public", faviconPath: () => "/public/assets/favicon.ico" }
                      : name === "./screen-viewer-mixer"
                        ? require("../../apps/frontend/public/electron/screen-viewer-mixer")
                        : require(name)
        }
    )
    module.exports.register(() => main)
    return {
        windows,
        primary,
        secondary,
        open: (event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }) =>
            handlers.get("screen-share-viewer:open")(event),
        move: (bounds) => {
            mainBounds = bounds
        },
        unplug: () => {
            displays = [primary]
            screen.emit("display-removed", {}, secondary)
        }
    }
}
test("fullscreen viewer is placed on the monitor containing PlayTime before entering fullscreen, including negative coordinates", async () => {
    const f = fixture()
    await f.open()
    const win = f.windows[0]
    assert.equal(win.options.x, -2560)
    assert.equal(win.options.fullscreen, false)
    win.emit("ready-to-show")
    assert.deepEqual(win.calls, [["bounds", f.secondary.bounds], ["show"], ["fullscreen", true]])
})
test("moving PlayTime before opening again selects its new monitor and stale window callbacks cannot clear the replacement", async () => {
    const f = fixture()
    await f.open()
    const old = f.windows[0]
    old.emit("ready-to-show")
    f.move({ x: 100, y: 100, width: 1280, height: 800 })
    await f.open()
    assert(old.destroyed)
    const current = f.windows[1]
    current.emit("ready-to-show")
    assert.equal(current.options.x, 0)
    old.emit("ready-to-show")
    await f.open()
    assert.equal(f.windows.length, 2)
})
test("unplugging the selected monitor reopens fullscreen on the remaining display and rejects foreign IPC", async () => {
    const f = fixture()
    assert.equal((await f.open({ sender: {}, senderFrame: {} })).ok, false)
    assert.equal(f.windows.length, 0)
    await f.open()
    f.windows[0].emit("ready-to-show")
    f.unplug()
    assert.equal(f.windows.length, 2)
    f.windows[1].emit("ready-to-show")
    assert.equal(f.windows[1].options.x, 0)
})

test("fullscreen mixer accepts only bounded local demo volume changes", () => {
    const { mixerState, mixerChange } = require("../../apps/frontend/public/electron/screen-viewer-mixer")
    const state = mixerState({
        screen: 60,
        screenMuted: false,
        screenAvailable: true,
        screenLabel: "Demo",
        master: 90,
        participants: [{ username: "peer", volume: 100 }]
    })
    assert.deepEqual(Object.keys(state).sort(), ["screen", "screenAvailable", "screenLabel", "screenMuted"])
    assert.equal(mixerChange({ kind: "master", value: 0 }, state), null)
    assert.equal(mixerChange({ kind: "participant", username: "peer", value: 0 }, state), null)
    for (const value of [-1, 101, NaN, Infinity, "50"])
        assert.equal(mixerChange({ kind: "screen", value }, state), null)
    assert.deepEqual(mixerChange({ kind: "screen", value: 20 }, state), { kind: "screen", value: 20 })
    assert.equal(mixerChange({ kind: "screen", value: 20 }, { ...state, screenAvailable: false }), null)
})

test("macOS fullscreen stays on the chosen display without switching Spaces", async () => {
    const f = fixture("darwin")
    await f.open()
    const win = f.windows[0]
    win.emit("ready-to-show")
    assert.deepEqual(win.calls, [["bounds", f.secondary.bounds], ["show"], ["simple-fullscreen", true]])
})
