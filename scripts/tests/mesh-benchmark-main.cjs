const { app, BrowserWindow, ipcMain } = require("electron"),
    path = require("node:path"),
    fs = require("node:fs"),
    os = require("node:os")
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
app.whenReady()
    .then(async () => {
        const dir = process.env.PLAYTIME_TEST_DIR
        const win = new BrowserWindow({
            show: false,
            webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false }
        })
        win.webContents.on("console-message", (e) => {
            if (e.level === "error") console.error(e.message)
        })
        await win.loadFile(path.join(dir, "index.html"))
        const measurements = []
        const iceServers = process.env.MESH_ICE_CONFIG
            ? JSON.parse(fs.readFileSync(process.env.MESH_ICE_CONFIG, "utf8"))
            : []
        for (const count of (process.env.MESH_COUNTS || "5,10").split(",").map(Number)) {
            const value = await win.webContents.executeJavaScript(
                "window.benchmark(" + count + "," + JSON.stringify(iceServers) + ")",
                true
            )
            const processes = app.getAppMetrics()
            value.processWorkingSetMb = Math.round(processes.reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024)
            value.processCpuPercent = +processes.reduce((n, p) => n + p.cpu.percentCPUUsage, 0).toFixed(1)
            measurements.push(value)
        }
        const result = {
            runtime: "Electron " + process.versions.electron + " / Chromium " + process.versions.chrome,
            machine: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length },
            limitations:
                "Synthetic audio on one machine; excludes WAN quality, multiple devices and screen-share load. Not evidence for 15-30 participant capacity.",
            measurements
        }
        const output = path.resolve(process.env.MESH_OUTPUT || "dist/improvement-run/mesh-benchmark.json")
        fs.mkdirSync(path.dirname(output), { recursive: true })
        fs.writeFileSync(output, JSON.stringify(result, null, 2))
        console.log(JSON.stringify(result))
        app.exit(0)
    })
    .catch((e) => {
        console.error(e)
        app.exit(1)
    })
setTimeout(() => app.exit(1), 110000)
