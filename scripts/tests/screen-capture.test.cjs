const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

function fixture(platform = "win32") {
    const sources = [
        { id: "screen:1:0", name: "One" },
        { id: "screen:2:0", name: "Two" }
    ]
    const ipc = new Map()
    let handler,
        options,
        registrations = 0
    const main = { isDestroyed: () => false, webContents: { mainFrame: {} } }
    const electron = {
        ipcMain: {
            handle: (name, fn) => {
                registrations++
                ipc.set(name, fn)
            }
        },
        desktopCapturer: { getSources: async () => sources }
    }
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../apps/frontend/public/electron/screen-capture.js"), "utf8"), {
        module,
        process: { platform },
        require: (name) => {
            assert.equal(name, "electron")
            return electron
        }
    })
    const session = {
        setDisplayMediaRequestHandler: (fn, opts) => {
            handler = fn
            options = opts
        }
    }
    module.exports.registerScreenCapture(session, () => main)
    return {
        select: (id, event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }) =>
            ipc.get("screen-share:select-source")(event, id),
        request: async (changes = {}) => {
            let granted
            await handler(
                { frame: main.webContents.mainFrame, userGesture: true, audioRequested: true, ...changes },
                (result) => {
                    granted = result
                }
            )
            return JSON.parse(JSON.stringify(granted))
        },
        registerAgain: () => module.exports.registerScreenCapture(session, () => main),
        registrations: () => registrations,
        options: () => options
    }
}

test("selected display uses loopback without muting local playback, and selection is consumed", async () => {
    const f = fixture()
    await f.select("screen:2:0")
    assert.deepEqual(await f.request(), { video: { id: "screen:2:0", name: "Two" }, audio: "loopback" })
    assert.equal(await f.request(), null)
    f.registerAgain()
    assert.equal(f.registrations(), 1)
})

test("video-only shares omit loopback", async () => {
    const f = fixture()
    await f.select("screen:1:0")
    assert.equal((await f.request({ audioRequested: false })).audio, undefined)
})

test("rejects foreign frames, missing gestures and unavailable displays", async () => {
    const f = fixture()
    await assert.rejects(f.select("screen:1:0", { sender: {}, senderFrame: {} }), /Invalid screen capture sender/)
    await assert.rejects(f.select("screen:404:0"), /no longer available/)
    await f.select("screen:1:0")
    assert.equal(await f.request({ frame: {} }), null)
    await f.select("screen:1:0")
    assert.equal(await f.request({ userGesture: false }), null)
})

test("both platforms use the explicit source selection and same loopback handler", () => {
    assert.equal(fixture("darwin").options().useSystemPicker, false)
    assert.equal(fixture("win32").options().useSystemPicker, false)
})
