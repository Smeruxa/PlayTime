const assert = require("node:assert/strict")
const path = require("node:path")

async function checkFreeAppearance(page, output) {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.setViewportSize({ width: 1280, height: 860 })
    await page.evaluate(() => window.profileUi.setPlan("free"))
    await page.getByRole("tab", { name: "Профиль", exact: true }).click()
    await page.getByRole("tab", { name: "Оформление", exact: true }).click()
    const avatar = page.getByRole("radiogroup", { name: "Аватар", exact: true })
    const banner = page.getByRole("radiogroup", { name: "Баннер", exact: true })
    const screenshot = async (name) => {
        await page.waitForTimeout(220)
        await page.screenshot({ path: path.join(output, name + ".png") })
    }
    assert.equal(await avatar.getByRole("radio", { name: "Лепестки", exact: true }).count(), 0)
    assert.equal(await banner.getByRole("radio").count(), 2)
    await avatar.getByRole("radio", { name: "Ореол", exact: true }).click()
    await banner.getByRole("radio", { name: "Тихий свет", exact: true }).click()
    await page.getByRole("button", { name: "Сохранить", exact: true }).click()
    await page.getByRole("status").filter({ hasText: "Сохранено" }).waitFor()
    const saved = await page.evaluate(() => window.profileUi.updates.at(-1))
    assert.equal(saved.profileAvatarEffect, "halo")
    assert.equal(saved.profileBannerEffect, "glow")
    const glow = banner.getByRole("radio", { name: "Тихий свет", exact: true }).locator('[class*="softGlow"]')
    assert.equal(await glow.count(), 1)
    assert.equal(await banner.getByRole("radio", { name: "Тихий свет", exact: true }).locator("svg").count(), 1)
    const firstTransform = await glow.evaluate((el) => getComputedStyle(el, "::before").transform)
    await page.waitForTimeout(350)
    assert.notEqual(await glow.evaluate((el) => getComputedStyle(el, "::before").transform), firstTransform)
    assert.equal(await page.getByRole("button", { name: "Изменить баннер", exact: true }).isDisabled(), true)
    await screenshot("free-appearance")
    const updatesBefore = await page.evaluate(() => window.profileUi.updates.length)
    for (const [label, name] of [
        ["Ещё эффекты аватара", "Medium"],
        ["Ещё эффекты баннера", "Pro"],
        ["Ещё наклейки", "Pro"]
    ]) {
        const more = page.getByRole("button", { name: label, exact: true })
        await more.click()
        const modal = page.getByRole("dialog", { name: "Больше оформления", exact: true })
        await modal.waitFor()
        const target = modal.getByRole("link", { name: "Сравнить тарифы" })
        assert.equal(await target.getAttribute("href"), "https://smeruxa.ru/playtime/#appearance-plans")
        assert.match(
            await modal
                .getByRole("heading", { name: new RegExp("^" + name) })
                .locator("..")
                .getAttribute("class"),
            /recommended/
        )
        assert.equal(/[«»]/.test(await modal.innerText()), false)
        await screenshot(
            label === "Ещё эффекты аватара"
                ? "upgrade-avatar"
                : label === "Ещё эффекты баннера"
                  ? "upgrade-banner"
                  : "upgrade-stickers"
        )
        await page.keyboard.press("Escape")
        await modal.waitFor({ state: "detached" })
        assert.equal(await more.evaluate((el) => document.activeElement === el), true)
    }
    assert.equal(await page.evaluate(() => window.profileUi.updates.length), updatesBefore)
    assert.equal(await page.getByRole("button", { name: "Сохранить", exact: true }).count(), 0)
    await page.getByRole("button", { name: "Превью для друзей", exact: true }).click()
    const preview = page.getByRole("dialog", { name: "Карточка у друзей", exact: true })
    const card = preview.getByRole("article")
    assert.deepEqual(await card.locator("[data-effect]").evaluateAll((els) => els.map((el) => el.dataset.effect)), [
        "glow",
        "halo"
    ])
    await screenshot("free-friend-preview")
    await preview.getByRole("button", { name: "Закрыть", exact: true }).first().click()
    await preview.waitFor({ state: "detached" })
    await page.setViewportSize({ width: 600, height: 800 })
    await page.getByRole("button", { name: "Ещё эффекты баннера", exact: true }).click()
    const smallModal = page.getByRole("dialog", { name: "Больше оформления", exact: true })
    await smallModal.waitFor()
    const bounds = await smallModal.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 600 && bounds.y >= 0 && bounds.y + bounds.height <= 800)
    await screenshot("upgrade-narrow")
    await page.keyboard.press("Escape")
    await smallModal.waitFor({ state: "detached" })
    await page.setViewportSize({ width: 1280, height: 860 })
    await page.evaluate(() => window.profileUi.setPlan("pro"))
    await page.getByRole("tab", { name: "Профиль", exact: true }).click()
    await page.getByRole("tab", { name: "Оформление", exact: true }).click()
    assert.equal(await page.getByRole("button", { name: "Ещё эффекты аватара", exact: true }).count(), 0)
    await avatar.getByRole("radio", { name: "Лепестки", exact: true }).click()
    await avatar
        .getByRole("radio", { name: "Лепестки", exact: true })
        .screenshot({ path: path.join(output, "bloom-picker-fixed.png") })
    await page.getByRole("tab", { name: "Профиль", exact: true }).click()
    await page.getByRole("article", { name: "Карточка alex", exact: true }).waitFor()
    await screenshot("bloom-profile-fixed")
    for (let sample = 0; sample < 3; sample++) {
        const radii = await page.locator('[data-effect="bloom"]').evaluateAll((avatars) =>
            avatars.flatMap((avatar) => {
                const box = avatar.getBoundingClientRect()
                return [...avatar.querySelectorAll("use")].map((petal) => {
                    const point = new DOMPoint(0, 0).matrixTransform(petal.getScreenCTM())
                    return Math.hypot(point.x - box.x - box.width / 2, point.y - box.y - box.height / 2) / box.width
                })
            })
        )
        assert.ok(radii.length >= 10)
        assert.ok(
            radii.every((radius) => radius > 0.47 && radius < 0.61),
            JSON.stringify(radii)
        )
        await page.waitForTimeout(260)
    }
    assert.equal(/[«»]/.test(await page.getByRole("tabpanel").innerText()), false)
}
module.exports = { checkFreeAppearance }
