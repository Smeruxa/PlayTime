const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path"),
    { buildSync } = require("esbuild")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
;(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-mesh-benchmark-"))
    let browser
    try {
        buildSync({
            entryPoints: [path.join(__dirname, "tests/mesh-benchmark-renderer.ts")],
            outfile: path.join(dir, "renderer.js"),
            bundle: true,
            platform: "browser",
            define: { "process.env.NODE_ENV": '"test"' }
        })
        fs.writeFileSync(
            path.join(dir, "index.html"),
            '<!doctype html><html><body><script src="renderer.js"></script></body></html>'
        )
        browser = await chromium.launch({
            headless: true,
            executablePath: process.env.VIEWER_BROWSER_PATH,
            args: [
                "--autoplay-policy=no-user-gesture-required",
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                "--disable-features=WebRtcHideLocalIpsWithMdns"
            ]
        })
        const page = await browser.newPage({ permissions: ["microphone"] })
        page.on("console", (m) => {
            if (m.type() === "error") console.error(m.text())
        })
        await page.goto("file://" + path.join(dir, "index.html"))
        const iceServers = process.env.MESH_ICE_CONFIG
            ? JSON.parse(fs.readFileSync(process.env.MESH_ICE_CONFIG, "utf8"))
            : []
        const measurements = []
        for (const count of (process.env.MESH_COUNTS || "5,10").split(",").map(Number))
            measurements.push(
                await page.evaluate(({ count, iceServers }) => window.benchmark(count, iceServers), {
                    count,
                    iceServers
                })
            )
        const result = {
            runtime: await browser.version(),
            machine: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length },
            limitations:
                "Synthetic audio on one machine; excludes WAN quality, multiple devices and screen-share load. Not evidence for 15-30 participant capacity.",
            measurements
        }
        const output = path.resolve(process.env.MESH_OUTPUT || "dist/improvement-run/mesh-benchmark.json")
        fs.mkdirSync(path.dirname(output), { recursive: true })
        fs.writeFileSync(output, JSON.stringify(result, null, 2))
        console.log(JSON.stringify(result))
    } finally {
        await browser?.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})().catch((e) => {
    console.error(e)
    process.exitCode = 1
})
