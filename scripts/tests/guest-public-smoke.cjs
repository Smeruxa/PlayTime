const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const origin = "https://smeruxa.ru"
const output = path.resolve("artifacts/guest-public-2.0.18")
async function run() {
    assert.equal(process.env.GUEST_PUBLIC_PHASE0_GO, "1", "Hold: phase-0 public smoke requires explicit root GO")
    await fs.mkdir(output, { recursive: true })
    const errors = [],
        assetFailures = [],
        requestFailures = [],
        httpFailures = [],
        blockedMutations = [],
        screenshots = [],
        pages = []
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {})
    })
    try {
        assert.match(browser.version(), /^158\./, "Pinned Chrome158 required")
        for (const width of [1440, 390]) {
            const context = await browser.newContext({
                viewport: { width, height: width === 390 ? 844 : 1000 },
                reducedMotion: "reduce",
                serviceWorkers: "block"
            })
            const page = await context.newPage()
            page.on("pageerror", (error) => errors.push({ width, error: error.stack || error.message }))
            page.on("requestfailed", (request) =>
                requestFailures.push({
                    width,
                    method: request.method(),
                    url: new URL(request.url()).origin + new URL(request.url()).pathname,
                    error: request.failure()?.errorText
                })
            )
            page.on("response", (response) => {
                if (response.status() < 400) return
                const record = {
                    width,
                    status: response.status(),
                    type: response.request().resourceType(),
                    url: new URL(response.url()).origin + new URL(response.url()).pathname
                }
                httpFailures.push(record)
                if (["script", "stylesheet", "font", "image", "document"].includes(record.type))
                    assetFailures.push(record)
            })
            await page.route("**/*", (route) => {
                const request = route.request()
                if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.continue()
                const url = new URL(request.url())
                blockedMutations.push({ width, method: request.method(), path: url.pathname })
                return route.fulfill({ status: 204, body: "" })
            })
            const settle = async () => {
                await page.waitForLoadState("networkidle", { timeout: 15000 })
                await page.evaluate(async () => {
                    await document.fonts.ready
                    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                })
            }
            const capture = async (name) => {
                const file = `${name}-${width}.png`
                await page.screenshot({ path: path.join(output, file), fullPage: true })
                screenshots.push(file)
            }
            await page.goto(origin + "/playtime/", { waitUntil: "domcontentloaded", timeout: 30000 })
            await page.getByRole("link", { name: "Открыть в браузере", exact: true }).first().waitFor()
            await settle()
            await capture("landing")
            const link = page.getByRole("link", { name: "Открыть в браузере", exact: true }).first()
            const target = new URL(await link.getAttribute("href"), page.url())
            assert.equal(target.origin, origin)
            assert.equal(target.pathname, "/playtime/app/")
            await link.click()
            await page.getByRole("button", { name: "Войти в аккаунт", exact: true }).waitFor()
            await settle()
            await capture("app-welcome")
            await page.getByRole("button", { name: "Войти в аккаунт", exact: true }).click()
            await page.getByRole("heading", { name: "Вход в аккаунт", exact: true }).waitFor()
            await page.locator('input[type="password"]').waitFor()
            await settle()
            assert.equal(await page.locator('input[type="password"]').inputValue(), "")
            assert.equal(await page.locator('input[type="email"]').inputValue(), "")
            await capture("app-login")
            pages.push({
                width,
                landing: origin + "/playtime/",
                login: page.url(),
                title: await page.title(),
                horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
            })
            const response = await context.request.get(origin + "/playtime/billing/catalog", { timeout: 15000 })
            assert.equal(response.status(), 200)
            const catalog = await response.json()
            assert.equal(catalog.mode, "test", "Public billing remains in test mode")
            pages[pages.length - 1].billingMode = catalog.mode
            await context.close()
        }
        assert.deepEqual(errors, [], "No JavaScript runtime errors")
        assert.deepEqual(assetFailures, [], "No document or asset HTTP failures")
        assert.deepEqual(requestFailures, [], "No failed requests")
        assert(
            pages.every((page) => !page.horizontalOverflow),
            "No horizontal login overflow"
        )
        await fs.writeFile(
            path.join(output, "report.json"),
            JSON.stringify(
                {
                    passed: true,
                    readOnly: true,
                    browser: browser.version(),
                    pages,
                    screenshots,
                    errors,
                    assetFailures,
                    requestFailures,
                    httpFailures,
                    blockedMutations
                },
                null,
                4
            ) + "\n"
        )
        console.log(JSON.stringify({ passed: true, output, screenshots }))
    } catch (error) {
        await fs.writeFile(
            path.join(output, "failure.json"),
            JSON.stringify(
                {
                    passed: false,
                    error: error.stack,
                    errors,
                    assetFailures,
                    requestFailures,
                    httpFailures,
                    blockedMutations
                },
                null,
                4
            ) + "\n"
        )
        throw error
    } finally {
        await browser.close()
    }
}
if (require.main === module)
    run().catch((error) => {
        console.error(error.message)
        process.exitCode = 1
    })
