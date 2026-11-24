const { app, BrowserWindow, ipcMain, desktopCapturer, session, systemPreferences } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const { spawn } = require("node:child_process")
const testDir = process.env.PLAYTIME_TEST_DIR
const systemAudio = process.env.PLAYTIME_TEST_SYSTEM_AUDIO === "1"
const direct = process.env.PLAYTIME_TEST_DIRECT === "1"
let tone
let reported = false
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
app.whenReady()
    .then(async () => {
        const preload = path.join(testDir, "preload.cjs")
        fs.writeFileSync(
            preload,
            `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('electronAPI',{selectScreenSource:(id)=>ipcRenderer.invoke('screen-share:select-source',id)}); contextBridge.exposeInMainWorld('qa',{systemAudio:${systemAudio},direct:${direct},source:()=>ipcRenderer.invoke('qa:source'),report:(data)=>ipcRenderer.send('qa:report',data)});`
        )
        const win = new BrowserWindow({
            show: false,
            webPreferences: { preload, contextIsolation: true, sandbox: false, backgroundThrottling: false }
        })
        require(path.join(process.env.PLAYTIME_TEST_ROOT, "apps/frontend/public/electron/screen-capture.js")).registerScreenCapture(
        session.defaultSession,
            () => win
        )
        session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
            callback(wc === win.webContents && ["media", "display-capture"].includes(permission))
        )
        ipcMain.handle(
            "qa:source",
            async () =>
                (await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }))[0]?.id
        )
        ipcMain.on("qa:report", (_event, data) => {
            reported = true
            console.log(
                JSON.stringify(
                    { electron: process.versions.electron, context: direct ? "direct" : "party", systemAudio, ...data },
                    null,
                    2
                )
            )
            tone?.kill()
            app.exit(data.ok ? 0 : 1)
        })
        if (systemAudio) {
            console.log("Screen permission: " + systemPreferences.getMediaAccessStatus("screen"))
            const rate = 48000,
                samples = rate * 70
            const wav = Buffer.alloc(44 + samples * 2)
            wav.write("RIFF")
            wav.writeUInt32LE(wav.length - 8, 4)
            wav.write("WAVEfmt ", 8)
            wav.writeUInt32LE(16, 16)
            wav.writeUInt16LE(1, 20)
            wav.writeUInt16LE(1, 22)
            wav.writeUInt32LE(rate, 24)
            wav.writeUInt32LE(rate * 2, 28)
            wav.writeUInt16LE(2, 32)
            wav.writeUInt16LE(16, 34)
            wav.write("data", 36)
            wav.writeUInt32LE(samples * 2, 40)
            for (let i = 0; i < samples; i++)
                wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 303 * i) / rate) * 1600), 44 + i * 2)
            const tonePath = path.join(testDir, "external-303hz.wav")
            fs.writeFileSync(tonePath, wav)
            tone = spawn("/usr/bin/afplay", [tonePath])
        }
        win.webContents.on("console-message", (event) => {
            if (/Error|FAIL|webrtc/.test(event.message)) console.log(event.message)
        })
        await win.loadFile(path.join(testDir, "index.html"))
        await win.webContents.executeJavaScript("window.runScreenShareTests()", true)
    })
    .catch((error) => {
        console.error(error)
        tone?.kill()
        app.exit(1)
    })
app.on("will-quit", () => tone?.kill())
setTimeout(() => {
    if (!reported) {
        console.error("Screen share test timed out")
        tone?.kill()
        app.exit(1)
    }
}, 75000)
