const assert = require("node:assert/strict")
const path = require("node:path")
const fs = require("node:fs/promises")
require("tsx/cjs")
const { listPlansPublic } = require("../../apps/shared/subscription/planCatalog.ts")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const output = process.env.SITE_VISITS_SCREENSHOT_DIR || "/private/tmp/playtime-site-visits-ui"
const origin = "http://127.0.0.1:4180"
let server, browser
;(async () => {
    const { createServer } = await import("vite")
    await fs.mkdir(output, { recursive: true })
    server = await createServer({
        root: path.resolve(__dirname, "../../apps/site"),
        configFile: path.resolve(__dirname, "../../apps/site/vite.config.ts"),
        server: { port: 4180, strictPort: true, host: "127.0.0.1", open: false, hmr: false, watch: null }
    })
    await server.listen()
    browser = await chromium.launch({
        headless: true,
        ...(process.env.PROFILE_BROWSER_PATH ? { executablePath: process.env.PROFILE_BROWSER_PATH } : {})
    })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    const requests = [],
        errors = [],
        external = []
    let unavailable = false
    const visits = {
        today: 128,
        week: 864,
        total: 4128,
        enabledAt: "2026-11-04T00:00:00Z",
        timeZone: "Europe/Moscow",
        sessionMinutes: 30
    }
    const setup = async (target) => {
        target.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)))
        await target.route("**/*", async (route) => {
            const request = route.request(),
                url = new URL(request.url())
            if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") {
                external.push(url.origin)
                return route.abort()
            }
            if (url.pathname.endsWith("/site-analytics/visit")) {
                requests.push(request.postDataJSON())
                return route.fulfill({ status: 204 })
            }
            if (url.pathname.endsWith("/subscription/plans"))
                return route.fulfill({ json: { plans: listPlansPublic() } })
            if (url.pathname.endsWith("/releases/latest")) return route.fulfill({ json: { releases: {} } })
            if (url.pathname.endsWith("/admin/access"))
                return route.fulfill({ json: { allowed: true, clientIp: "192.0.2.1" } })
            if (url.pathname.endsWith("/admin/visits"))
                return route.fulfill(unavailable ? { status: 503, json: { error: "offline" } } : { json: { visits } })
            if (url.pathname.endsWith("/admin/stats"))
                return route.fulfill({
                    json: {
                        stats: {
                            usersTotal: 24,
                            blockedTotal: 0,
                            usersByPlan: [
                                { plan: "free", count: 20 },
                                { plan: "pro", count: 4 }
                            ],
                            releasesPublished: 2,
                            latestDownloads: {}
                        }
                    }
                })
            if (url.pathname.endsWith("/admin/health"))
                return route.fulfill({ status: 503, json: { error: "fixture" } })
            if (url.pathname.endsWith("/admin/audit")) return route.fulfill({ json: { entries: [] } })
            if (url.pathname.includes("/feedback-api/challenge"))
                return route.fulfill({ json: { token: "fixture", cooldownSeconds: 900 } })
            return route.continue()
        })
    }
    await setup(context)
    const page = await context.newPage()
    await page.goto(`${origin}/playtime/`)
    await page.waitForFunction(() => document.cookie.includes("pt_site_visit_v1="))
    await page.waitForTimeout(150)
    assert.ok(requests.length >= 1)
    const first = requests[0].sessionId
    assert.match(first, /^[a-f0-9]{32}$/)
    assert.deepEqual(Object.keys(requests[0]).sort(), ["page", "sessionId"])
    const cookie = (await context.cookies()).find((entry) => entry.name === "pt_site_visit_v1")
    assert.equal(cookie.path, "/playtime")
    assert.equal(cookie.sameSite, "Strict")
    assert.ok(cookie.expires > Date.now() / 1000 + 1790 && cookie.expires <= Date.now() / 1000 + 1801)
    await page.reload()
    await page.goto(`${origin}/playtime/legal/privacy`)
    await page.waitForTimeout(150)
    assert.ok(requests.some((entry) => entry.page === "privacy"))
    assert.ok(requests.every((entry) => entry.sessionId === first))

    const tabs = await Promise.all([context.newPage(), context.newPage()])
    await Promise.all(tabs.map((tab) => tab.goto(`${origin}/playtime/`)))
    await page.waitForTimeout(150)
    assert.equal(new Set(requests.map((entry) => entry.sessionId)).size, 1)
    await Promise.all(tabs.map((tab) => tab.close()))
    const previousExpiry = (await context.cookies()).find((entry) => entry.name === "pt_site_visit_v1").expires
    await page.waitForTimeout(1100)
    await page.reload()
    await page.waitForTimeout(150)
    assert.ok((await context.cookies()).find((entry) => entry.name === "pt_site_visit_v1").expires > previousExpiry)

    await context.clearCookies()
    const initialTabs = await Promise.all([context.newPage(), context.newPage()])
    const beforeNewVisit = requests.length
    await Promise.all(initialTabs.map((tab) => tab.goto(`${origin}/playtime/`)))
    await page.waitForTimeout(150)
    assert.equal(
        new Set(requests.slice(beforeNewVisit).map((entry) => entry.sessionId)).size,
        1,
        "Simultaneous first tabs share one id"
    )
    assert.notEqual(requests.at(-1).sessionId, first)
    await Promise.all(initialTabs.map((tab) => tab.close()))
    const publicRequests = requests.length
    await page.goto(`${origin}/playtime/admin/panel`)
    const section = page.getByRole("region", { name: "Посещения сайта" })
    await section.getByText("4 128").waitFor()
    await page.waitForTimeout(150)
    assert.equal(requests.length, publicRequests, "Admin never sends visit events")
    await page.evaluate(() => document.fonts.ready)
    await section.screenshot({ path: path.join(output, "admin-visits-metrics.png") })
    await page.screenshot({ path: path.join(output, "admin-visits-1440.png"), fullPage: true })
    for (const width of [768, 375, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.waitForTimeout(100)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await page.screenshot({ path: path.join(output, `admin-visits-${width}.png`), fullPage: true })
    }
    unavailable = true
    await page.getByRole("button", { name: "Обновить", exact: true }).click()
    await section.getByRole("status").waitFor()
    assert.match(await section.innerText(), /временно недоступна/)
    assert.equal(await page.getByText("пользователей", { exact: false }).isVisible(), true)
    assert.equal(
        await section
            .locator("dd")
            .allTextContents()
            .then((values) => values.every((value) => value === "—")),
        true
    )
    await page.screenshot({ path: path.join(output, "admin-visits-unavailable.png"), fullPage: true })
    await page.goto(`${origin}/playtime/login`)
    await page.waitForTimeout(200)
    assert.equal(requests.length, publicRequests, "Login never sends visit events")
    await context.close()

    for (const mode of ["dnt", "gpc", "blocked-cookie"]) {
        const privateContext = await browser.newContext({ reducedMotion: "reduce" })
        await setup(privateContext)
        await privateContext.addInitScript((kind) => {
            if (kind === "blocked-cookie") Object.defineProperty(document, "cookie", { get: () => "", set: () => {} })
            else
                Object.defineProperty(navigator, kind === "dnt" ? "doNotTrack" : "globalPrivacyControl", {
                    get: () => (kind === "dnt" ? "1" : true)
                })
        }, mode)
        const privatePage = await privateContext.newPage()
        await privatePage.goto(`${origin}/playtime/`)
        await privatePage.locator("#appearance-plans").waitFor()
        await privatePage.waitForTimeout(150)
        assert.equal(requests.length, publicRequests, `${mode} does not track or break the page`)
        await privateContext.close()
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log(
        JSON.stringify(
            {
                ok: true,
                publicRequests,
                uniqueSessions: new Set(requests.map((entry) => entry.sessionId)).size,
                errors,
                external,
                output
            },
            null,
            2
        )
    )
})()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await browser?.close()
        await server?.close()
    })
