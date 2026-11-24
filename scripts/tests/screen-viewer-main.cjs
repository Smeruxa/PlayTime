const { app, BrowserWindow, screen } = require("electron"),
    path = require("node:path"),
    fs = require("node:fs"),
    assert = require("node:assert/strict")
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(check) {
    for (let i = 0; i < 200; i++) {
        if (await check()) return
        await wait(70)
    }
    throw new Error("Viewer IPC did not settle")
}
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
let main
require(path.join(process.env.PLAYTIME_TEST_ROOT, "apps/frontend/public/electron/screen-share-viewer-window.js")).register(() => main)
app.whenReady()
    .then(async () => {
        const root = process.env.PLAYTIME_TEST_ROOT
        main = new BrowserWindow({
            show: true,
            x: 100,
            y: 100,
            width: 960,
            height: 600,
            webPreferences: {
                preload: path.join(root, "apps/frontend/public/preload.js"),
                contextIsolation: true,
                sandbox: false,
                backgroundThrottling: false
            }
        })
        main.on("closed", () => console.log("QA main closed"))
        await app.dock?.show()
        app.focus({ steal: true })
        await main.loadFile(path.join(process.env.PLAYTIME_TEST_DIR, "index.html"))
        await until(() =>
            main.webContents.executeJavaScript('typeof window.snapshot === "function" && window.snapshot().demo === 1')
        )
        assert.equal((await main.webContents.executeJavaScript("window.electronAPI.screenShareViewerOpen()")).ok, true)
        const viewer = BrowserWindow.getAllWindows().find((w) => w !== main)
        viewer.webContents.on("console-message", (e) => console.log("VIEWER", e.message))
        viewer.on("closed", () => console.log("QA viewer closed"))
        viewer.on("enter-full-screen", () => console.log("QA entered fullscreen"))
        viewer.webContents.on("did-fail-load", (_, code, description) => console.log({ code, description }))
        await until(() => !viewer.webContents.isLoading() && viewer.isVisible())
        console.log("QA viewer visible", viewer.getBounds(), viewer.isFullScreen())
        assert.equal(screen.getDisplayMatching(viewer.getBounds()).id, screen.getDisplayMatching(main.getBounds()).id)
        await until(() =>
            viewer.webContents.executeJavaScript('document.querySelectorAll("input[type=range]").length===1')
        )
        await viewer.webContents.executeJavaScript(
            '(()=>{document.getElementById("mixerToggle").click(); const input=document.querySelector("input[type=range]"); input.value="35"; input.dispatchEvent(new Event("input",{bubbles:true}))})()'
        )
        await until(() => main.webContents.executeJavaScript("window.snapshot().demo === .35"))
        const changed = await main.webContents.executeJavaScript("window.snapshot()")
        assert.equal(changed.voice, 0.42)
        assert.equal(changed.master, "83")
        assert(changed.trackEnabled && changed.trackUnchanged && changed.demoPlaying)
        const iconButtons = await viewer.webContents.executeJavaScript(
            '[...document.querySelectorAll(".toolbar button")].every(b=>!b.textContent.trim())'
        )
        assert(iconButtons)
        await until(() => viewer.isFullScreen() || viewer.isSimpleFullScreen())
        const output = path.join(root, "artifacts/screen-viewer-playback/electron-fullscreen.png")
        fs.mkdirSync(path.dirname(output), { recursive: true })
        fs.writeFileSync(output, (await viewer.webContents.capturePage()).toPNG())
        await viewer.webContents.executeJavaScript(
            '(()=>{const input=document.querySelector("input[type=range]"); input.value="0"; input.dispatchEvent(new Event("input",{bubbles:true}))})()'
        )
        await until(() => main.webContents.executeJavaScript("!window.snapshot().demoPlaying"))
        const muted = await main.webContents.executeJavaScript("window.snapshot()")
        assert.equal(muted.voice, 0.42)
        assert(muted.trackEnabled && muted.trackUnchanged)
        assert.equal(muted.demo, 0)
        assert.equal(muted.demoMuted, true)
        assert.equal(muted.videoAudioTracks, 0)
        const levels = []
        for (const level of [1, 50, 100]) {
            await viewer.webContents.executeJavaScript(
                `(()=>{const input=document.querySelector("input[type=range]"); input.value="${level}"; input.dispatchEvent(new Event("input",{bubbles:true}))})()`
            )
            await until(() => main.webContents.executeJavaScript(`window.snapshot().demo === ${level / 100}`))
            const value = await main.webContents.executeJavaScript("window.snapshot()")
            assert(value.demoPlaying && !value.demoMuted && value.videoAudioTracks === 0)
            levels.push(value.demo)
        }
        const report = {
            passed: true,
            scope: "Real Electron production preload, sandboxed viewer IPC, React mixer and video/audio playback",
            changed,
            muted,
            levels,
            screenshot: path.relative(root, output)
        }
        fs.writeFileSync(
            path.join(path.dirname(output), "electron-report.json"),
            JSON.stringify(report, null, 4) + "\n"
        )
        await main.webContents.executeJavaScript("window.closeDemo()")
        assert.equal(await main.webContents.executeJavaScript('document.querySelectorAll("#demo audio").length'), 0)
        console.log(
            JSON.stringify({
                ok: true,
                checks: [
                    "Production sandboxed viewer IPC changes only local demo audio",
                    "Exactly one slider and icon-only toolbar",
                    "Voice playback, master volume and outgoing track unchanged at 35% and mute",
                    "Native fullscreen display matches main window"
                ],
                snapshot: changed,
                screenshot: output
            })
        )
        app.exit(0)
    })
    .catch((error) => {
        console.error(error)
        app.exit(1)
    })
setTimeout(() => {
    console.error("Native viewer timed out")
    app.exit(1)
}, 30000)
