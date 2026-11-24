const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const http = require("node:http")
const { build } = require("esbuild")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")

;(async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-viewer-playback-"))
    const output = path.resolve(process.env.VIEWER_SCREENSHOT_DIR || "artifacts/screen-viewer-playback")
    await fs.mkdir(output, { recursive: true })
    let browser, server
    try {
        await build({
            entryPoints: [path.resolve("scripts/tests/screen-viewer-playback-peer.tsx")],
            outfile: path.join(temporary, "viewer.js"),
            bundle: true,
            jsx: "automatic",
            define: { "process.env.NODE_ENV": '"test"' }
        })
        server = http.createServer(async (request, response) => {
            const file =
                request.url === "/viewer.js" ? "viewer.js" : request.url === "/viewer.css" ? "viewer.css" : null
            if (file) {
                response.setHeader("Content-Type", file.endsWith("css") ? "text/css" : "text/javascript")
                response.end(await fs.readFile(path.join(temporary, file)))
            } else {
                response.setHeader("Content-Type", "text/html")
                response.end(
                    '<!doctype html><html><head><title>PlayTime screen viewer QA</title><link rel="stylesheet" href="/viewer.css"></head><body style="margin:0;background:#08090b;color:white"><div id="root"></div><script src="/viewer.js"></script></body></html>'
                )
            }
        })
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
        browser = await chromium.launch({
            headless: false,
            ...(process.env.VIEWER_BROWSER_PATH ? { executablePath: process.env.VIEWER_BROWSER_PATH } : {}),
            args: [
                "--autoplay-policy=no-user-gesture-required",
                "--enable-usermedia-screen-capturing",
                "--auto-select-tab-capture-source-by-title=PlayTime screen viewer QA",
                "--allow-http-screen-capture"
            ]
        })
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
        const errors = []
        page.on("pageerror", (error) => errors.push(error.message))
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        await page.getByRole("button", { name: "Capture rendered audio" }).click()
        await page.waitForFunction(() => document.body.dataset.captureReady === "true")
        await page.getByRole("button", { name: "На весь экран", exact: true }).click({ force: true })
        await page.waitForFunction(() => window.viewerQA.snapshot().fullscreenContainer)
        assert.equal(await page.locator("video[controls]").count(), 0)
        assert.equal(await page.getByRole("button", { name: /pause|пауза|play|воспроизвести/i }).count(), 0)
        assert.equal(await page.locator("video").evaluate((video) => video.srcObject.getAudioTracks().length), 0)
        const slider = page.getByRole("slider", { name: "Громкость демонстрации", exact: true })
        const rms = {}
        for (const level of [100, 50, 1, 0]) {
            await slider.fill(String(level))
            rms[level] = await page.evaluate(() => window.viewerQA.measure())
            assert.equal(await slider.inputValue(), String(level))
        }
        assert(rms[100] > 0.05, `Full-volume output missing: ${rms[100]}`)
        assert(rms[50] > rms[100] * 0.3 && rms[50] < rms[100] * 0.7)
        assert(rms[1] > 0.0001 && rms[1] < rms[50] * 0.1)
        assert(rms[0] < 0.00001, `Zero-volume output is audible: ${rms[0]}`)
        await page.locator("video").evaluate((video) => {
            video.muted = false
            video.volume = 1
        })
        const nativeBypassRms = await page.evaluate(() => window.viewerQA.measure())
        assert(nativeBypassRms < 0.00001, "Unmuting the video bypassed the demo mixer")
        const zero = await page.evaluate(() => window.viewerQA.snapshot())
        assert(zero.audioMuted && !zero.audioAttached && zero.sourceEnabled)
        await page.screenshot({ path: path.join(output, "browser-fullscreen-zero.png") })
        await page.evaluate(() => window.viewerQA.voice(true))
        const voiceWhileDemoMuted = await page.evaluate(() => window.viewerQA.measure())
        assert(voiceWhileDemoMuted > 0.01, "Demo mute silenced the separate voice output")
        await page.evaluate(() => window.viewerQA.voice(false))
        await page.getByRole("button", { name: "Включить звук демонстрации", exact: true }).click()
        assert.equal(await slider.inputValue(), "1")
        assert((await page.evaluate(() => window.viewerQA.measure())) > 0.0001)
        await slider.fill("50")
        await page.getByRole("button", { name: "Выключить звук демонстрации", exact: true }).click()
        const explicitMuteRms = await page.evaluate(() => window.viewerQA.measure())
        assert(explicitMuteRms < 0.00001)
        await page.evaluate(() => window.viewerQA.reconnect())
        assert((await page.evaluate(() => window.viewerQA.measure())) < 0.00001)
        await page.getByRole("button", { name: "Включить звук демонстрации", exact: true }).click()
        assert.equal(await slider.inputValue(), "50")
        await page.getByRole("button", { name: "Beta", exact: true }).click()
        assert.equal(await slider.inputValue(), "100")
        await page.getByRole("button", { name: "Alpha", exact: true }).click()
        assert.equal(await slider.inputValue(), "50")
        await page.screenshot({ path: path.join(output, "browser-fullscreen-volume.png") })
        await page.keyboard.press("Escape")
        await page.waitForFunction(() => !document.fullscreenElement)
        assert((await page.evaluate(() => window.viewerQA.measure())) > 0.02)
        await page.locator("video").hover()
        await page.getByRole("button", { name: "На весь экран", exact: true }).click()
        await page.waitForFunction(() => window.viewerQA.snapshot().fullscreenContainer)
        await page.getByRole("button", { name: "Выйти из полного экрана", exact: true }).click()
        await page.waitForFunction(() => !document.fullscreenElement)
        assert.deepEqual(errors, [])
        const report = {
            passed: true,
            scope: "Actual React viewer/mixer and fullscreen helper, generated MediaStreams, Chromium rendered-tab-audio capture; no production signaling",
            browser: browser.version(),
            rms,
            explicitMuteRms,
            nativeBypassRms,
            voiceWhileDemoMuted,
            zero,
            checks: [
                "Container fullscreen without native timer/pause",
                "Rendered audio RMS at 0/1/50/100",
                "Zero and explicit mute are silent",
                "Mute/unmute restores nonzero gain",
                "Reconnect stays muted",
                "Per-source volume survives selection",
                "Separate voice remains audible",
                "Escape and fullscreen button exit",
                "No JS errors"
            ]
        }
        await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 4) + "\n")
        console.log(JSON.stringify(report, null, 2))
    } finally {
        await browser?.close()
        if (server) await new Promise((resolve) => server.close(resolve))
        await fs.rm(temporary, { recursive: true, force: true })
    }
})().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
