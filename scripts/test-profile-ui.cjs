const assert = require("node:assert/strict")
const path = require("node:path")
const fs = require("node:fs/promises")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const root = path.resolve(__dirname, "..")
const output = process.env.PROFILE_SCREENSHOT_DIR || "/private/tmp/playtime-profile-ui"
const { checkQuietProfile } = require("./tests/quiet-profile-ui.cjs")
const { checkFreeAppearance } = require("./tests/free-profile-appearance-ui.cjs")
const { createAccountApi, checkAccountPage } = require("./tests/account-profile-ui.cjs")
let server, browser
;(async () => {
    const { createServer } = await import("vite")
    await fs.mkdir(output, { recursive: true })
    server = await createServer({
        root,
        publicDir: path.join(root, "apps/frontend/public"),
        optimizeDeps: { entries: ["scripts/fixtures/profile-ui.tsx"] },
        server: { port: 4176, open: false, hmr: false, watch: null },
        plugins: [
            {
                name: "isolated-profile-ui",
                configureServer(vite) {
                    vite.middlewares.use("/__profile-ui", async (_request, response) => {
                        response.setHeader("Content-Type", "text/html")
                        response.end(
                            await vite.transformIndexHtml(
                                "/__profile-ui",
                                '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root" style="display:flex"></div><script type="module" src="/scripts/fixtures/profile-ui.tsx"></script></body></html>'
                            )
                        )
                    })
                }
            }
        ]
    })
    await server.listen()
    browser = await chromium.launch({
        headless: true,
        ...(process.env.PROFILE_BROWSER_PATH ? { executablePath: process.env.PROFILE_BROWSER_PATH } : {})
    })
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: "no-preference" })
    const errors = [],
        externalRequests = []
    const accountApi = process.env.PROFILE_UI_ACCOUNT ? createAccountApi() : null
    page.on("pageerror", (error) => {
        errors.push(error.message)
        console.error(error.message)
    })
    await page.route("**/*", async (route) => {
        if (accountApi && (await accountApi.handle(route))) return
        const url = new URL(route.request().url())
        if (url.protocol === "data:" || url.hostname === "127.0.0.1") return route.continue()
        externalRequests.push(url.origin)
        return route.abort()
    })
    if (process.env.PROFILE_UI_QUIET) await page.emulateMedia({ reducedMotion: "reduce" })
    if (accountApi)
        await page.addInitScript(
            (secret) => localStorage.setItem("playtime_keys_dev:1", JSON.stringify({ dm: secret })),
            Buffer.alloc(32, 7).toString("base64")
        )
    await page.goto(`http://127.0.0.1:4176/__profile-ui${accountApi ? "?account" : ""}#conversation`)
    const feedbackLink = page.getByRole("link", { name: "Фич-реквест: идея или ошибка" })
    assert.equal(await feedbackLink.getAttribute("href"), "https://smeruxa.ru/playtime/feedback")
    assert.equal(await feedbackLink.getAttribute("target"), "_blank")
    const feedbackBox = await feedbackLink.boundingBox()
    const settingsBox = await page.getByRole("button", { name: "Настройки", exact: true }).boundingBox()
    assert.ok(feedbackBox.y < settingsBox.y, "Feature requests precede settings after the separator")
    await page
        .getByRole("complementary", { name: "Навигация" })
        .screenshot({ path: path.join(output, "feature-request-rail.png") })
    if (accountApi) {
        await checkAccountPage(page, output, accountApi)
        assert.deepEqual(errors, [])
        assert.deepEqual(externalRequests, [])
        console.log(
            JSON.stringify({
                output,
                errors,
                externalRequests,
                checks: "account layout, real forms, password, encrypted backup and restore, key transfer, session confirmation, delete hold, focus, responsive layout"
            })
        )
        return
    }
    if (process.env.PROFILE_UI_QUIET) {
        await checkQuietProfile(page, output)
        assert.deepEqual(errors, [])
        assert.deepEqual(externalRequests, [])
        console.log(
            JSON.stringify({
                output,
                errors,
                externalRequests,
                checks: "quiet profile, preview parity with drawer and modal, plan visibility, unsaved changes, empty and long text, responsive layout"
            })
        )
        return
    }
    await page.getByRole("tab", { name: "Оформление", exact: true }).click()
    await page.getByRole("radiogroup", { name: "Аватар", exact: true }).waitFor()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(output, "appearance-desktop.png") })
    await page.getByRole("radiogroup", { name: "Наклейка на баннер" }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, "appearance-stickers-desktop.png") })
    await page.setViewportSize({ width: 1280, height: 860 })
    await page.getByRole("button", { name: "Диалоги", exact: true }).click()
    await page.locator("header").getByTitle("Профиль", { exact: true }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(output, "profile-drawer-desktop.png") })
    if (process.env.PROFILE_UI_BASELINE) {
        console.log(JSON.stringify({ output, errors, externalRequests, baseline: true }))
        return
    }
    const screenshot = async (name) => {
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(output, `${name}.png`) })
    }
    const waitForEffect = async (locator, effect) => {
        await locator.locator(`[data-effect="${effect}"]`).first().waitFor()
    }
    const drawer = page.getByRole("dialog", { name: "Профиль mira", exact: true })
    await waitForEffect(drawer, "orbit")
    assert.equal(
        await drawer.getByText("😍", { exact: true }).count(),
        1,
        "Decorated banner must render without a photo"
    )
    await page.evaluate(() =>
        window.profileUi.update("mira", {
            profileAvatarEffect: "prism",
            profileBannerEffect: "ember",
            profileBannerSticker: "ghost"
        })
    )
    await waitForEffect(drawer, "prism")
    await waitForEffect(page.locator("header"), "prism")
    await waitForEffect(page.getByRole("list", { name: "Участники звонка" }), "prism")
    await waitForEffect(page.getByRole("complementary", { name: "Список чатов" }), "prism")
    assert.equal(
        await page.locator("header").getByText("👻", { exact: true }).count(),
        1,
        "DM banner sticker is visible"
    )
    await screenshot("updated-profile-drawer-desktop")
    await page.keyboard.press("Escape")
    await page.getByRole("dialog").waitFor({ state: "detached" })
    await screenshot("conversation-call-desktop")
    await page.getByTitle("Позвонить", { exact: true }).click()
    await waitForEffect(drawer, "prism")
    await page.evaluate(() =>
        window.profileUi.update("mira", {
            profileAvatarEffect: "frost",
            profileBannerEffect: "snow",
            profileBannerSticker: "cat"
        })
    )
    await waitForEffect(drawer, "frost")
    assert.equal(await drawer.getByText("🐱", { exact: true }).count(), 1)
    await screenshot("profile-modal-desktop")
    await page.getByRole("button", { name: "Закрыть", exact: true }).click()
    await page.getByRole("button", { name: "Друзья", exact: true }).click()
    await page.getByRole("heading", { name: "Друзья", exact: true }).waitFor()
    await waitForEffect(page.getByRole("main").or(page.locator("#root")), "frost")
    await page.evaluate(() => window.profileUi.update("mira", { profileAvatarEffect: "neon" }))
    await waitForEffect(page.locator("#root"), "neon")
    await screenshot("friends-desktop")
    await page.getByRole("button", { name: "Профиль", exact: true }).click()
    await page.waitForFunction(() => window.profileUi.listenerCount()["profile:updated"] === 1)
    await page.getByRole("tab", { name: "Оформление", exact: true }).click()
    const avatar = page.getByRole("radiogroup", { name: "Аватар", exact: true })
    const banner = page.getByRole("radiogroup", { name: "Баннер", exact: true })
    const sticker = page.getByRole("radiogroup", { name: "Наклейка на баннер" })
    const compareAppearancePreview = async () => {
        await page.getByRole("button", { name: "Превью для друзей", exact: true }).click()
        const previewModal = page.getByRole("dialog", { name: "Карточка у друзей", exact: true })
        const cardData = (el) => ({
            text: el.innerText,
            images: [...el.querySelectorAll("img")].map((img) => img.getAttribute("src")),
            effects: [...el.querySelectorAll("[data-effect]")].map((node) => node.getAttribute("data-effect"))
        })
        const previewCard = previewModal.getByRole("article", { name: "Карточка alex", exact: true })
        const expected = await previewCard.evaluate(cardData)
        assert.equal(expected.text.includes("alex@example.test"), false)
        await screenshot(
            "appearance-preview-" +
                (await page.evaluate(() => document.querySelector('[class*="plan_"]')?.textContent || "current"))
        )
        await previewModal.getByRole("button", { name: "Закрыть", exact: true }).first().click()
        await previewModal.waitFor({ state: "detached" })
        for (const surface of ["drawer", "modal"]) {
            await page.evaluate((surface) => window.profileUi.inspectSelf(surface), surface)
            const friendModal = page.getByRole("dialog", { name: "Профиль alex", exact: true })
            const actual = friendModal.getByRole("article", { name: "Карточка alex", exact: true })
            await actual.waitFor()
            assert.deepEqual(
                await actual.evaluate(cardData),
                expected,
                `Appearance preview matches the friend ${surface}`
            )
            await page.evaluate(() => window.profileUi.inspectSelf(null))
            await friendModal.waitFor({ state: "detached" })
        }
    }
    assert.deepEqual(
        await Promise.all([avatar, banner, sticker].map((group) => group.getByRole("radio").count())),
        [9, 6, 17]
    )
    for (const group of [avatar, banner, sticker]) {
        for (const button of await group.getByRole("radio").all()) {
            await button.click()
            assert.equal(await button.getAttribute("aria-checked"), "true")
            assert.equal(await button.isVisible(), true)
        }
    }
    await avatar.getByRole("radio", { name: "Призма", exact: true }).focus()
    await page.keyboard.press("Home")
    assert.equal(
        await avatar.getByRole("radio", { name: "Без эффекта", exact: true }).getAttribute("aria-checked"),
        "true"
    )
    await page.keyboard.press("ArrowRight")
    assert.equal(await avatar.getByRole("radio", { name: "Ореол", exact: true }).getAttribute("aria-checked"), "true")
    await page.keyboard.press("End")
    await banner.getByRole("radio", { name: "Искры", exact: true }).click()
    await sticker.getByRole("radio", { name: "Призрак", exact: true }).click()
    await page.getByRole("button", { name: "Сохранить", exact: true }).click()
    await page.getByRole("status").filter({ hasText: "Сохранено" }).waitFor()
    const saved = await page.evaluate(() => window.profileUi.updates.at(-1))
    assert.deepEqual(
        [saved.profileAvatarEffect, saved.profileBannerEffect, saved.profileBannerSticker],
        ["prism", "ember", "ghost"]
    )
    await page.getByRole("tab", { name: "Профиль", exact: true }).click()
    await waitForEffect(page.getByRole("tabpanel"), "prism")
    assert.equal(await page.getByRole("tabpanel").getByText("👻", { exact: true }).count(), 1)
    await screenshot("saved-profile-desktop")
    await page.getByRole("tab", { name: "Оформление", exact: true }).click()
    await avatar.getByRole("radio", { name: "Ореол", exact: true }).click()
    await banner.getByRole("radio", { name: "Сакура", exact: true }).click()
    await page.getByRole("button", { name: "Превью для друзей", exact: true }).click()
    const draftPreview = page.getByRole("dialog", { name: "Карточка у друзей", exact: true })
    await draftPreview.getByText("Так будет выглядеть профиль после сохранения.", { exact: true }).waitFor()
    assert.deepEqual(
        await draftPreview
            .locator("[data-effect]")
            .evaluateAll((elements) => elements.map((el) => el.getAttribute("data-effect"))),
        ["sakura", "halo"]
    )
    await draftPreview.getByRole("button", { name: "Закрыть", exact: true }).first().click()
    await draftPreview.waitFor({ state: "detached" })
    await page.getByRole("button", { name: "Отменить", exact: true }).click()
    assert.equal(await avatar.getByRole("radio", { name: "Призма", exact: true }).getAttribute("aria-checked"), "true")
    assert.equal(await banner.getByRole("radio", { name: "Искры", exact: true }).getAttribute("aria-checked"), "true")
    await compareAppearancePreview()
    await page.evaluate(() => window.profileUi.failSave(true))
    await avatar.getByRole("radio", { name: "Неон", exact: true }).click()
    await page.getByRole("button", { name: "Сохранить", exact: true }).click()
    await page.getByRole("status").filter({ hasText: "Не удалось" }).waitFor()
    assert.match(
        await page.getByRole("status").getAttribute("class"),
        /stickySaveStatusErr/,
        "Any failed save is styled as an error"
    )
    await screenshot("save-error-desktop")
    await page.evaluate(() => window.profileUi.failSave(false))
    await page.getByRole("button", { name: "Сохранить", exact: true }).click()
    await page.getByRole("status").filter({ hasText: "Сохранено" }).waitFor()
    await page.setViewportSize({ width: 1280, height: 860 })
    await avatar.getByRole("radio", { name: "Лепестки", exact: true }).click()
    await banner.getByRole("radio", { name: "Снегопад", exact: true }).click()
    await sticker.getByRole("radio", { name: "Кот", exact: true }).click()
    const imageData = await page.evaluate(() => {
        const canvas = document.createElement("canvas")
        canvas.width = 640
        canvas.height = 240
        const context = canvas.getContext("2d")
        const gradient = context.createLinearGradient(0, 0, 640, 240)
        gradient.addColorStop(0, "#4954a8")
        gradient.addColorStop(1, "#126477")
        context.fillStyle = gradient
        context.fillRect(0, 0, 640, 240)
        context.fillStyle = "#d1edff"
        context.font = "bold 100px sans-serif"
        context.fillText("A", 285, 155)
        return canvas.toDataURL("image/png").split(",")[1]
    })
    const upload = { name: "profile.png", mimeType: "image/png", buffer: Buffer.from(imageData, "base64") }
    for (const [index, title] of [
        [0, "Сохранить аватарку?"],
        [1, "Сохранить новый баннер?"]
    ]) {
        const before = await page.evaluate(() => window.profileUi.updates.length)
        const chooserEvent = page.waitForEvent("filechooser")
        await page.getByRole("button", { name: index ? "Изменить баннер" : "Изменить фото", exact: true }).click()
        await (await chooserEvent).setFiles(upload)
        await page.getByRole("dialog", { name: title, exact: true }).waitFor()
        await screenshot(index ? "confirm-banner-upload" : "confirm-avatar-upload")
        await page.getByRole("button", { name: "Отмена", exact: true }).click()
        assert.equal(await page.evaluate(() => window.profileUi.updates.length), before)
        const retryChooserEvent = page.waitForEvent("filechooser")
        await page.getByRole("button", { name: index ? "Изменить баннер" : "Изменить фото", exact: true }).click()
        await (await retryChooserEvent).setFiles(upload)
        const confirm = page.getByRole("dialog", { name: title, exact: true })
        if (index === 0) {
            await page.evaluate(() => window.profileUi.failSave(true))
            await confirm.getByRole("button", { name: "Сохранить", exact: true }).click()
            await confirm.getByRole("alert").filter({ hasText: "Не удалось сохранить" }).waitFor()
            await screenshot("upload-save-error")
            await page.evaluate(() => window.profileUi.failSave(false))
        }
        await confirm.getByRole("button", { name: "Сохранить", exact: true }).click()
        await confirm.waitFor({ state: "detached" })
        await page.getByRole("status").filter({ hasText: "Сохранено" }).waitFor()
    }
    const withMedia = await page.evaluate(() => window.profileUi.updates)
    const avatarUpload = withMedia.findLast((update) => update.avatar)
    assert.deepEqual(
        [avatarUpload.profileAvatarEffect, avatarUpload.profileBannerEffect, avatarUpload.profileBannerSticker],
        ["bloom", "snow", "cat"]
    )
    assert.match(avatarUpload.avatar, /^data:image\/(jpeg|webp);base64,/)
    await page.getByRole("tab", { name: "Профиль", exact: true }).click()
    await screenshot("profile-with-uploaded-media")
    await page.getByRole("tab", { name: "Оформление", exact: true }).click()
    await avatar.scrollIntoViewIfNeeded()
    assert.equal(await avatar.getByRole("radio", { name: "Лепестки", exact: true }).locator("img").count(), 1)
    await banner.scrollIntoViewIfNeeded()
    assert.equal(await banner.getByRole("radio", { name: "Снегопад", exact: true }).locator("img").count(), 1)
    await screenshot("effects-on-uploaded-media")
    await compareAppearancePreview()
    const particle = banner
        .getByRole("radio", { name: "Снегопад", exact: true })
        .locator('[class*="snowFlake"]')
        .first()
    const firstTransform = await particle.evaluate((el) => getComputedStyle(el).transform)
    await screenshot("animation-frame-a")
    await page.waitForTimeout(500)
    assert.notEqual(await particle.evaluate((el) => getComputedStyle(el).transform), firstTransform)
    await screenshot("animation-frame-b")
    for (const [width, height] of [
        [1440, 1100],
        [1024, 900],
        [800, 800],
        [600, 900]
    ]) {
        await page.setViewportSize({ width, height })
        await page.getByRole("tab", { name: "Профиль", exact: true }).click()
        await page.getByRole("tab", { name: "Оформление", exact: true }).click()
        await screenshot(`appearance-${width}`)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await banner.scrollIntoViewIfNeeded()
        await screenshot(`banner-${width}`)
        await sticker.scrollIntoViewIfNeeded()
        await screenshot(`stickers-${width}`)
        assert.equal(
            await sticker.evaluate((el) => el.scrollWidth > el.clientWidth),
            false,
            "Sticker grid must not scroll horizontally"
        )
        for (const group of [avatar, banner, sticker]) {
            assert.equal(
                await group.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
                false,
                "Options must fit without horizontal scrolling"
            )
        }
        if (width === 1024) {
            const scrollbar = await page
                .getByRole("tabpanel")
                .locator("..")
                .evaluate((el) => ({
                    color: getComputedStyle(el).scrollbarColor,
                    width: getComputedStyle(el).scrollbarWidth
                }))
            assert.notEqual(scrollbar.color, "auto")
            assert.equal(scrollbar.width, "thin")
        }
    }
    for (const plan of ["free", "medium"]) {
        await page.evaluate((plan) => window.profileUi.setPlan(plan), plan)
        await page.getByRole("tab", { name: "Профиль", exact: true }).click()
        await page.getByRole("tab", { name: "Оформление", exact: true }).click()
        await screenshot(`appearance-${plan}`)
        assert.equal(await avatar.getByRole("radio").count(), plan === "free" ? 3 : 9)
        assert.equal(await banner.getByRole("radio").count(), 2)
        assert.equal(await sticker.getByRole("radio").count(), 1)
        assert.equal(await banner.getByRole("radio", { name: "Тихий свет", exact: true }).isEnabled(), true)
        assert.equal(
            await page.getByRole("button", { name: "Изменить баннер", exact: true }).isDisabled(),
            plan === "free"
        )
        await banner.getByRole("radio", { name: "Без эффекта", exact: true }).focus()
        await page.keyboard.press("ArrowRight")
        assert.equal(
            await banner.getByRole("radio", { name: "Тихий свет", exact: true }).getAttribute("aria-checked"),
            "true"
        )
        await page.getByRole("button", { name: "Отменить", exact: true }).click()
        await banner.getByRole("radio", { name: "Без эффекта", exact: true }).click()
        assert.equal(
            await page.getByRole("button", { name: "Сохранить", exact: true }).count(),
            0,
            "An already selected locked-plan fallback does not create unsavable changes"
        )
        await compareAppearancePreview()
    }
    await page.evaluate(() => window.profileUi.setPlan("pro"))
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.getByRole("tab", { name: "Профиль", exact: true }).click()
    await page.getByRole("tab", { name: "Оформление", exact: true }).click()
    await avatar.getByRole("radio", { name: "Орбита", exact: true }).click()
    await screenshot("appearance-reduced-motion")
    assert.equal(
        await page
            .locator('[data-effect="orbit"] svg circle')
            .first()
            .evaluate((el) => getComputedStyle(el).animationName),
        "none"
    )
    const staticParticle = banner
        .getByRole("radio", { name: "Снегопад", exact: true })
        .locator('[class*="snowFlake"]')
        .first()
    await banner.getByRole("radio", { name: "Снегопад", exact: true }).click()
    await page.waitForTimeout(200)
    const pausedTransform = await staticParticle.evaluate((el) => getComputedStyle(el).transform)
    await page.waitForTimeout(300)
    assert.equal(await staticParticle.evaluate((el) => getComputedStyle(el).transform), pausedTransform)
    for (const label of ["Убрать баннер", "Убрать фото профиля"]) {
        page.once("dialog", (dialog) => dialog.accept())
        await page.getByRole("button", { name: label, exact: true }).click()
        await page.getByRole("status").filter({ hasText: "Сохранено" }).waitFor()
        const removal = await page.evaluate(() => window.profileUi.updates.at(-1))
        if (label === "Убрать баннер") {
            assert.deepEqual(
                [removal.profileBanner, removal.profileBannerEffect, removal.profileBannerSticker],
                ["", "none", "none"]
            )
        } else assert.equal(removal.avatar, "")
    }
    await checkFreeAppearance(page, output)
    assert.deepEqual(errors, [])
    assert.deepEqual(externalRequests, [])
    console.log(
        JSON.stringify({
            output,
            errors,
            externalRequests,
            widths: [1440, 1024, 800, 600],
            checks: "all options, save, retry, live updates, chat, friends, calls, drawer, modal, keyboard, grids, appearance preview parity, discard, plans, reduced motion"
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
