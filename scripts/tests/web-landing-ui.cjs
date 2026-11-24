const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { once } = require("node:events")
const { createRequire } = require("node:module")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
require("tsx/cjs")
const backendRequire = createRequire(path.resolve(__dirname, "../../apps/package.json"))
const express = backendRequire("express")
const helmet = backendRequire("helmet")
const { attachMarketingSite } = require("../../apps/gateway/http/serveSite.ts")
const { listPlansPublic } = require("../../apps/shared/subscription/planCatalog.ts")
const output = process.env.WEB_SCREENSHOT_DIR || path.resolve("artifacts/web-landing")
let server, browser

;(async () => {
    await fs.mkdir(output, { recursive: true })
    process.env.SITE_DIST_PATH = path.resolve(__dirname, "../../apps/site/dist")
    process.env.WEB_DIST_PATH = path.resolve(__dirname, "../../web-dist")
    const app = express()
    app.use(helmet())
    attachMarketingSite(app)
    server = app.listen(0, "127.0.0.1")
    await once(server, "listening")
    const origin = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({ headless: true, ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {}) })
    const page = await browser.newPage({ reducedMotion: "reduce", serviceWorkers: "block" })
    page.setDefaultTimeout(15000)
    const errors = [], badAssets = [], external = []
    page.on("pageerror", error => errors.push(error.message))
    page.on("response", response => {
        if (response.status() >= 400 && ["stylesheet", "script", "image", "font"].includes(response.request().resourceType())) badAssets.push(response.url())
    })
    await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== origin && url.protocol !== "data:") { external.push(url.origin); return route.abort() }
        if (url.pathname.endsWith("/subscription/plans")) return route.fulfill({ json: { plans: listPlansPublic() } })
        if (url.pathname.endsWith("/site-analytics/visit")) return route.fulfill({ status: 204 })
        if (url.pathname.endsWith("/releases/latest")) return route.fulfill({ json: { releases: Object.fromEntries(["darwin", "win32"].map(platform => [platform, {
            version: "2.0.15", platform, fileSize: 120586240, filename: `PlayTime-${platform}`, url: `${origin}/playtime/downloads/${platform}`
        }])) } })
        if (["fetch", "xhr"].includes(request.resourceType())) return route.fulfill({ status: 404, json: { error: "Isolated fixture" } })
        return route.continue()
    })
    for (const [width, height] of [[1440, 1000], [1024, 900], [390, 844], [320, 740]]) {
        await page.setViewportSize({ width, height })
        await page.goto(`${origin}/playtime/`, { waitUntil: "networkidle" })
        await page.evaluate(() => document.fonts.ready)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Landing overflow at ${width}`)
        const webLinks = page.getByRole("link", { name: "Открыть в браузере", exact: true })
        assert.equal(await webLinks.count(), 2)
        for (const link of await webLinks.all()) assert.equal(await link.getAttribute("href"), "/playtime/app/")
        await page.screenshot({ path: path.join(output, `landing-${width}.png`) })
        const chat = page.getByLabel("Демонстрационная переписка", { exact: true })
        const backgrounds = await chat.evaluate(thread =>
            ["bubbleOther", "bubbleMine"].map(name => getComputedStyle(thread.querySelector(`[class*="${name}"]`)).backgroundColor)
        )
        assert.deepEqual(backgrounds, ["rgb(38, 42, 46)", "rgb(34, 55, 68)"], `Chat bubble backgrounds at ${width}`)
        if (width === 1440) {
            await page.getByRole("tabpanel", { name: "Чаты", exact: true }).screenshot({ path: path.join(output, "landing-chat-demo-1440.png") })
        }
        await page.locator("#download").scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.join(output, `download-${width}.png`) })
        await page.locator(".draft-browser-option").click()
        await page.getByRole("button", { name: /Войти по нику/ }).waitFor()
        assert.equal(new URL(page.url()).pathname, "/playtime/app/")
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Web welcome overflow at ${width}`)
        await page.screenshot({ path: path.join(output, `landing-to-web-${width}.png`) })
        await page.getByRole("link", { name: "На главную PlayTime" }).click()
        await webLinks.first().waitFor()
        await webLinks.first().click()
        await page.getByRole("button", { name: /Войти по нику/ }).waitFor()
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(badAssets, [])
    assert.deepEqual(external, [])
    const report = { generatedAt: new Date().toISOString(), browser: browser.version(), widths: [1440, 1024, 390, 320], screenshotCount: 13, screenshots: output, pageErrors: errors, badAssets, external }
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
    await browser?.close()
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
