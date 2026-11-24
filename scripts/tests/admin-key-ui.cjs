const assert = require("node:assert/strict")
const path = require("node:path")
const fs = require("node:fs/promises")
require("tsx/cjs")
const { createAdminLoginCommand } = require("../../apps/site/src/auth/adminLogin.ts")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const output = process.env.ADMIN_KEY_SCREENSHOT_DIR || "/private/tmp/playtime-admin-key-ui"
const origin = "http://127.0.0.1:4181"
const fixtureKey = "ui-fixture-not-a-real-credential"
let server, browser
;(async () => {
    const { createServer } = await import("vite")
    await fs.mkdir(output, { recursive: true })
    server = await createServer({
        root: path.resolve(__dirname, "../../apps/site"),
        configFile: path.resolve(__dirname, "../../apps/site/vite.config.ts"),
        server: { port: 4181, strictPort: true, host: "127.0.0.1", open: false, hmr: false, watch: null }
    })
    await server.listen()
    browser = await chromium.launch({
        headless: true,
        ...(process.env.PROFILE_BROWSER_PATH ? { executablePath: process.env.PROFILE_BROWSER_PATH } : {})
    })
    const errors = [],
        external = [],
        methods = []
    let authorized = false,
        accessStatus = 401,
        failLogout = false,
        releaseLogout
    let logoutStarted
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)))
    await context.route("**/*", async (route) => {
        const request = route.request(),
            url = new URL(request.url())
        if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") {
            external.push(url.origin)
            return route.abort()
        }
        if (url.pathname.endsWith("/site-analytics/visit")) return route.fulfill({ status: 204 })
        if (url.pathname.endsWith("/admin/access"))
            return route.fulfill(
                authorized
                    ? { json: { allowed: true, clientIp: "192.0.2.10" } }
                    : { status: accessStatus, json: { allowed: false } }
            )
        if (url.pathname.endsWith("/admin/session")) {
            methods.push(request.method())
            assert.equal(request.headers()["x-playtime-admin"], "1")
            if (request.method() === "POST") {
                assert.deepEqual(request.postDataJSON(), { key: fixtureKey })
                authorized = true
                return route.fulfill({ json: { allowed: true } })
            }
            assert.equal(request.method(), "DELETE")
            if (failLogout) return route.fulfill({ status: 503, json: { error: "fixture" } })
            logoutStarted?.()
            await new Promise((resolve) => {
                releaseLogout = resolve
            })
            authorized = false
            return route.fulfill({ status: 204 })
        }
        if (
            url.pathname.includes("/admin/") &&
            ["stats", "health", "audit", "visits", "users"].some((name) => url.pathname.endsWith(`/admin/${name}`))
        ) {
            assert.equal(authorized, true, "Protected data is requested only after authorization")
            if (url.pathname.endsWith("/stats"))
                return route.fulfill({
                    json: {
                        stats: {
                            usersTotal: 24,
                            blockedTotal: 0,
                            usersByPlan: [],
                            releasesPublished: 2,
                            latestDownloads: {}
                        }
                    }
                })
            if (url.pathname.endsWith("/audit")) return route.fulfill({ json: { entries: [] } })
            if (url.pathname.endsWith("/users")) return route.fulfill({ json: { users: [] } })
            if (url.pathname.endsWith("/visits"))
                return route.fulfill({
                    json: {
                        visits: {
                            today: 4,
                            week: 12,
                            total: 24,
                            enabledAt: "2026-11-05T00:00:00Z",
                            timeZone: "Europe/Moscow",
                            sessionMinutes: 30
                        }
                    }
                })
            return route.fulfill({ status: 503, json: { error: "fixture" } })
        }
        return route.continue()
    })
    const page = await context.newPage()
    await page.goto(`${origin}/playtime/admin`)
    await page.getByRole("heading", { name: "Доступ ограничен" }).waitFor()
    assert.equal(await page.locator("input, textarea, form").count(), 0, "The login page has no credential form")
    assert.doesNotMatch(await page.locator("main").innerText(), /ключ|консол|DevTools|Console|команд|инструмент/i)
    assert.equal(await page.getByRole("button", { name: "Скопировать команду" }).count(), 0)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: path.join(output, "admin-key-login-1440.png"), fullPage: true })
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 900 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await page.screenshot({ path: path.join(output, `admin-key-login-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    const command = createAdminLoginCommand("/playtime", "/playtime/admin/panel")
    assert.equal(typeof command, "string")
    assert.match(command, /prompt\("Ключ администратора PlayTime"\)/)
    assert.doesNotMatch(command, /localStorage|sessionStorage|console\./)
    assert.equal(command.includes(fixtureKey), false)
    page.once("dialog", (dialog) => dialog.accept(fixtureKey))
    const loginNavigation = page.waitForURL("**/playtime/admin/panel")
    const commandExecution = page.evaluate(command).catch(() => undefined)
    await loginNavigation
    await commandExecution
    await page.getByRole("heading", { name: "Обзор", exact: true }).waitFor()
    await page.getByRole("link", { name: "Пользователи", exact: true }).click()
    await page.getByRole("heading", { name: "Пользователи", exact: true }).waitFor()
    assert.equal(
        await page.evaluate(
            (key) =>
                [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) => value.includes(key)),
            fixtureKey
        ),
        false
    )
    await page.screenshot({ path: path.join(output, "admin-key-authorized.png"), fullPage: true })

    failLogout = true
    await page.getByRole("button", { name: "Выйти из панели" }).click()
    await page.getByRole("alert").getByText("Не удалось завершить сессию. Повторите выход.").waitFor()
    assert.equal(
        new URL(page.url()).pathname,
        "/playtime/admin/people",
        "Failed logout does not pretend the session ended"
    )
    failLogout = false
    const deleteStarted = new Promise((resolve) => {
        logoutStarted = resolve
    })
    await page.getByRole("button", { name: "Выйти из панели" }).click()
    await deleteStarted
    assert.equal(new URL(page.url()).pathname, "/playtime/admin/people", "Navigation waits for session revocation")
    assert.equal(await page.getByRole("button", { name: "Выходим…" }).isDisabled(), true)
    releaseLogout()
    await page.waitForURL("**/playtime/admin")
    await page.getByRole("heading", { name: "Доступ ограничен" }).waitFor()
    assert.deepEqual(methods, ["POST", "DELETE", "DELETE"])
    await page.goto(`${origin}/playtime/admin/panel`)
    await page.getByRole("link", { name: "Перейти ко входу" }).waitFor()
    assert.equal(await page.getByRole("heading", { name: "Обзор", exact: true }).count(), 0)

    accessStatus = 403
    await page.goto(`${origin}/playtime/admin`)
    await page.getByRole("heading", { name: "Доступ ограничен" }).waitFor()
    assert.equal(await page.getByRole("button", { name: "Скопировать команду" }).count(), 0)
    assert.doesNotMatch(await page.locator("main").innerText(), /ключ|консол|DevTools|Console|команд|инструмент/i)
    await page.screenshot({ path: path.join(output, "admin-key-denied.png"), fullPage: true })
    accessStatus = 503
    await page.reload()
    await page.getByRole("heading", { name: "Сервер недоступен" }).waitFor()
    accessStatus = 401
    await page.getByRole("button", { name: "Проверить снова" }).click()
    await page.getByRole("heading", { name: "Доступ ограничен" }).waitFor()
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log(
        JSON.stringify({
            ok: true,
            errors,
            external,
            output,
            checks: "neutral public admin page without instructions, saved console command, same-origin session, navigation, storage isolation, awaited logout, failure/denial/retry, responsive access page"
        })
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
