const assert = require("node:assert/strict")
const path = require("node:path")
const fs = require("node:fs/promises")
require("tsx/cjs")
const { listPlansPublic } = require("../../apps/shared/subscription/planCatalog.ts")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const output = process.env.PROFILE_SCREENSHOT_DIR || "/private/tmp/playtime-appearance-site"
let server, browser

async function preparePage(reducedMotion, errors) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion })
    page.on("pageerror", (error) => errors.push(error.message))
    await page.route("**/*", async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.endsWith("/subscription/plans")) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            return route.fulfill({ json: { plans: listPlansPublic() } })
        }
        if (url.pathname.endsWith("/releases/latest")) return route.fulfill({ json: { releases: {} } })
        if (url.pathname.endsWith("/site-analytics/visit")) return route.fulfill({ status: 204 })
        if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") return route.abort()
        return route.continue()
    })
    await page.goto("http://127.0.0.1:4177/playtime/#appearance-plans")
    const section = page.locator("#appearance-plans")
    await section.waitFor()
    await page.waitForFunction(() => {
        const top = document.getElementById("appearance-plans").getBoundingClientRect().top
        return top >= 0 && top < 160
    })
    await page.evaluate(() => document.fonts.ready)
    const showcase = section.getByRole("figure", { name: "Пример оформления профиля" })
    await showcase.waitFor()
    assert.equal(await showcase.evaluate((element) => element.matches("figure.draft-appearance-showcase")), true)
    const art = showcase.locator("img[data-appearance-art]")
    assert.equal(await art.count(), 1, "Showcase uses the real profile artwork")
    await art.evaluate(async (image) => {
        if (!image.complete) await new Promise((resolve, reject) => {
            image.addEventListener("load", resolve, { once: true })
            image.addEventListener("error", reject, { once: true })
        })
        await image.decode()
    })
    assert.equal(await art.evaluate((image) => image.complete && image.naturalWidth > 0), true)
    assert.equal(await showcase.locator(".draft-appearance-banner").isVisible(), true)
    assert.ok(await showcase.locator("svg [data-wave-layer]").count() > 0, "Showcase includes animated wave layers")
    return { page, section, showcase }
}

async function waveTransforms(showcase) {
    return showcase.locator("svg [data-wave-layer]").evaluateAll((layers) => layers.map((layer) => ({
        layer: layer.getAttribute("data-wave-layer"),
        transform: getComputedStyle(layer).transform,
        attribute: layer.getAttribute("transform")
    })))
}

;(async () => {
    const { createServer } = await import("vite")
    await fs.mkdir(output, { recursive: true })
    server = await createServer({
        root: path.resolve(__dirname, "../../apps/site"),
        configFile: path.resolve(__dirname, "../../apps/site/vite.config.ts"),
        server: { port: 4177, strictPort: true, host: "127.0.0.1", open: false, hmr: false, watch: null }
    })
    await server.listen()
    browser = await chromium.launch({
        headless: true,
        ...(process.env.PROFILE_BROWSER_PATH ? { executablePath: process.env.PROFILE_BROWSER_PATH } : {})
    })
    const errors = []
    const { page, section, showcase } = await preparePage("reduce", errors)
    const rows = section.locator("tbody tr")
    assert.deepEqual(await rows.nth(0).locator("td").allTextContents(), ["2", "8", "8", "8"])
    assert.deepEqual(await rows.nth(1).locator("td").allTextContents(), ["1", "1", "5", "5"])
    assert.deepEqual(await rows.nth(2).locator("td").allTextContents(), ["—", "Да", "Да", "Да"])
    assert.deepEqual(await rows.nth(3).locator("td").allTextContents(), ["—", "—", "Да", "Да"])
    assert.equal(/[«»]/.test(await page.locator("body").innerText()), false)
    const accent = section.getByText("Тихий свет", { exact: true })
    assert.equal(await accent.evaluate((el) => getComputedStyle(el).textDecorationLine), "underline")
    await showcase.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    const reducedTransforms = await waveTransforms(showcase)
    await page.waitForTimeout(700)
    assert.deepEqual(await waveTransforms(showcase), reducedTransforms, "Reduced motion keeps the waves still")
    await section.screenshot({ path: path.join(output, "landing-appearance-desktop.png") })
    await showcase.screenshot({ path: path.join(output, "landing-appearance-showcase-reduced.png") })
    for (const width of [1440, 1024, 768, 390, 375, 320]) {
        await page.setViewportSize({ width, height: 900 })
        await section.scrollIntoViewIfNeeded()
        await page.waitForTimeout(180)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
        assert.equal(overflow, false, `No document overflow at ${width}`)
        await section.screenshot({ path: path.join(output, `landing-appearance-${width}.png`) })
    }
    const motion = await preparePage("no-preference", errors)
    await motion.showcase.scrollIntoViewIfNeeded()
    await motion.page.waitForTimeout(200)
    const initialTransforms = await waveTransforms(motion.showcase)
    await motion.section.screenshot({ path: path.join(output, "landing-appearance-motion-start.png"), animations: "allow" })
    await motion.page.waitForTimeout(900)
    assert.notDeepEqual(await waveTransforms(motion.showcase), initialTransforms, "The waves animate in normal motion mode")
    await motion.section.screenshot({ path: path.join(output, "landing-appearance-motion.png"), animations: "allow" })
    await motion.showcase.screenshot({ path: path.join(output, "landing-appearance-showcase-motion.png"), animations: "allow" })
    await motion.showcase.getByRole("button", { name: "Приостановить анимацию" }).click()
    const resume = motion.showcase.getByRole("button", { name: "Включить анимацию" })
    assert.equal(await resume.getAttribute("aria-pressed"), "true")
    const pausedTransforms = await waveTransforms(motion.showcase)
    await motion.page.waitForTimeout(600)
    assert.deepEqual(await waveTransforms(motion.showcase), pausedTransforms, "The pause button freezes the waves")
    await resume.click()
    await motion.page.waitForTimeout(600)
    assert.notDeepEqual(await waveTransforms(motion.showcase), pausedTransforms, "The play button resumes the waves")
    assert.deepEqual(errors, [])
    console.log(
        JSON.stringify({
            output,
            errors,
            checks: "actual landing, delayed API anchor navigation, live plan comparison, text highlights, loaded artwork, animated waves, pause/resume, reduced motion, widths 1440/1024/768/390/375/320"
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
