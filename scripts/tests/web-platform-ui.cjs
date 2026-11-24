const assert = require("node:assert/strict")
const path = require("node:path")
const fs = require("node:fs/promises")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const root = path.resolve(__dirname, "../..")
const output = process.env.WEB_PLATFORM_SCREENSHOT_DIR || "/private/tmp/playtime-web-platform-ui"
let server, browser

;(async () => {
    const { createServer } = await import("vite")
    await fs.mkdir(output, { recursive: true })
    for (const name of ["screen-picker-desktop", "screen-picker-mobile", "screen-audio-unavailable-desktop", "screen-audio-unavailable-mobile"])
        await fs.rm(path.join(output, `${name}.png`), { force: true })
    server = await createServer({
        root,
        publicDir: path.join(root, "apps/frontend/public"),
        optimizeDeps: { entries: ["scripts/fixtures/web-platform-ui.tsx"] },
        server: { port: 4186, open: false, hmr: false, watch: null },
        plugins: [{
            name: "isolated-web-platform-ui",
            configureServer(vite) {
                vite.middlewares.use("/__web-platform", async (_request, response) => {
                    response.setHeader("Content-Type", "text/html")
                    response.end(await vite.transformIndexHtml("/__web-platform",
                        '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="display:flex"></div><script type="module" src="/scripts/fixtures/web-platform-ui.tsx"></script></body></html>'))
                })
            }
        }]
    })
    await server.listen()
    browser = await chromium.launch({ headless: true, ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {}) })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    const errors = [], external = []
    page.on("pageerror", error => errors.push(error.message))
    await page.route("**/*", route => {
        const url = new URL(route.request().url())
        if (url.hostname === "127.0.0.1" || url.protocol === "data:" || url.protocol === "blob:") return route.continue()
        external.push(url.origin)
        return route.abort()
    })
    await page.addInitScript(() => {
        window.platformQa = { allowMic: false, captureCalls: 0 }
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
            if (!window.platformQa.allowMic) throw new DOMException("Fixture permission denial", "NotAllowedError")
            return new MediaStream()
        } })
        Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { value: async () => [{ kind: "audioinput", deviceId: "default", label: "Микрофон по умолчанию" }] })
        Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: async () => {
            window.platformQa.captureCalls++
            const canvas = document.createElement("canvas")
            canvas.width = 320; canvas.height = 180
            return canvas.captureStream(1)
        } })
        Object.defineProperty(Notification, "permission", { configurable: true, value: "default" })
        Object.defineProperty(Notification, "requestPermission", { value: async () => {
            Object.defineProperty(Notification, "permission", { value: "granted" })
            return "granted"
        } })
    })
    const screenshot = async name => {
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(150)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + " overflows")
        await page.screenshot({ path: path.join(output, `${name}.png`) })
    }
    for (const [width, height, name] of [[1440, 1000, "desktop"], [390, 844, "mobile"]]) {
        await page.setViewportSize({ width, height })
        await page.goto("http://127.0.0.1:4186/__web-platform?surface=settings")
        await page.getByRole("button", { name: "Включить уведомления" }).waitFor()
        await screenshot(`settings-${name}`)
        await page.getByRole("button", { name: "Включить уведомления" }).click()
        await page.getByText(/Уведомления включены/).waitFor()
        await page.getByRole("button", { name: "Удержать — уровень" }).dispatchEvent("pointerdown")
        await page.getByRole("alert").filter({ hasText: "Разрешите доступ" }).waitFor()
        await screenshot(`settings-permission-${name}`)
        await page.keyboard.press("Escape")
        await page.getByRole("dialog").waitFor({ state: "detached" })

        await page.goto("http://127.0.0.1:4186/__web-platform?surface=screen")
        await page.getByText("Демонстрация экрана доступна в приложении PlayTime.", { exact: true }).waitFor()
        assert.equal(await page.getByRole("button", { name: "Выбрать экран" }).count(), 0)
        assert.equal(await page.getByRole("checkbox").count(), 0)
        const blocked = await page.evaluate(async () => {
            try { await window.platformCaptureProbe(); return null }
            catch (error) { return error.message }
        })
        assert.equal(blocked, "Демонстрация экрана доступна в приложении PlayTime.")
        assert.equal(await page.evaluate(() => window.platformQa.captureCalls), 0)
        await screenshot(`screen-disabled-${name}`)
        await page.getByRole("button", { name: "Понятно", exact: true }).click()
        await page.getByRole("dialog").waitFor({ state: "detached" })

        await page.goto("http://127.0.0.1:4186/__web-platform?surface=call")
        await page.getByRole("alert").filter({ hasText: "Разрешите доступ" }).waitFor()
        await screenshot(`call-permission-${name}`)
        await page.evaluate(() => { window.platformQa.allowMic = true })
        await page.getByRole("button", { name: "Повторить" }).click()
        await page.getByRole("list", { name: "Участники звонка" }).waitFor()
        assert.equal(await page.getByRole("alert").count(), 0)
        const share = page.getByRole("button", { name: "Демонстрация экрана", exact: true })
        assert.equal(await share.isDisabled(), true)
        assert.equal(await share.getAttribute("title"), "Демонстрация экрана доступна в приложении PlayTime.")
        assert.equal(await share.getAttribute("aria-description"), "Демонстрация экрана доступна в приложении PlayTime.")
        assert.equal(await page.evaluate(() => window.platformQa.captureCalls), 0)
        await screenshot(`call-retry-${name}`)
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    const report = { output, screenshots: 10, widths: [1440, 390], outgoingScreenShare: "disabled", nativeScreenCaptureCalls: 0, programmaticGuardChecked: true, errors, external }
    await fs.writeFile(path.join(output, "platform-report.json"), JSON.stringify(report, null, 2) + "\n")
    console.log(JSON.stringify(report))
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
    await browser?.close()
    await server?.close()
})
