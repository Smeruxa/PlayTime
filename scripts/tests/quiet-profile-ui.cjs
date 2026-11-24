const assert = require("node:assert/strict")
const path = require("node:path")

async function comparePixels(page, first, second) {
    return page.evaluate(
        async ([a, b]) => {
            const read = async (base64) => {
                const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
                const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
                const canvas = document.createElement("canvas")
                canvas.width = bitmap.width
                canvas.height = bitmap.height
                const ctx = canvas.getContext("2d")
                ctx.drawImage(bitmap, 0, 0)
                const result = {
                    width: bitmap.width,
                    height: bitmap.height,
                    data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
                }
                bitmap.close()
                return result
            }
            const left = await read(a),
                right = await read(b)
            if (Math.abs(left.width - right.width) > 1 || Math.abs(left.height - right.height) > 1)
                return { sizeMismatch: [left.width, left.height, right.width, right.height] }
            const width = Math.min(left.width, right.width),
                height = Math.min(left.height, right.height)
            let bad = 0,
                error = 0
            for (let pixel = 0; pixel < width * height; pixel++) {
                const x = pixel % width,
                    y = Math.floor(pixel / width)
                const a = (y * left.width + x) * 4,
                    b = (y * right.width + x) * 4
                const delta = [0, 1, 2].map((channel) => Math.abs(left.data[a + channel] - right.data[b + channel]))
                error += delta.reduce((sum, value) => sum + value, 0)
                if (Math.max(...delta) > 12) bad++
            }
            return { badRatio: bad / (width * height), meanError: error / (width * height * 3) }
        },
        [first.toString("base64"), second.toString("base64")]
    )
}

async function checkQuietProfile(page, output) {
    const panel = page.getByRole("tabpanel")
    const preview = panel.getByRole("article", { name: "Карточка alex", exact: true })
    const status = page.getByLabel("Статус", { exact: true })
    const bio = page.getByLabel("О себе", { exact: true })
    const screenshot = async (name) => {
        await page.waitForTimeout(220)
        await page.screenshot({ path: path.join(output, name + ".png") })
    }
    const save = async () => {
        await page.getByRole("button", { name: "Сохранить", exact: true }).click()
        await page.getByRole("status").filter({ hasText: "Сохранено" }).waitFor()
        await page.getByText("Так ваш профиль видят друзья.", { exact: true }).waitFor()
    }
    const snapshotCard = async (card, width, filename) => {
        await card.evaluate((el, width) => {
            const clone = el.cloneNode(true)
            clone.id = "profile-card-comparison"
            Object.assign(clone.style, {
                position: "fixed",
                left: "0",
                top: "0",
                zIndex: "200000",
                width: width + "px",
                height: "auto",
                transform: "none"
            })
            document.body.appendChild(clone)
        }, width)
        const clone = page.locator("#profile-card-comparison")
        try {
            return await clone.screenshot({ path: path.join(output, filename) })
        } finally {
            await clone.evaluate((el) => el.remove())
        }
    }
    await preview.waitFor()
    await page.getByText("Так ваш профиль видят друзья.", { exact: true }).waitFor()
    assert.equal(await preview.getByText("alex@example.test", { exact: true }).count(), 0)
    await status.fill("  На связи после 19:00  ")
    await bio.fill("  Вечером — в голосовом.\nЛюблю кооперативы, музыку и долгие разговоры.  ")
    await page.getByText("Так будет выглядеть профиль после сохранения.", { exact: true }).waitFor()
    assert.ok((await preview.innerText()).includes("На связи после 19:00"))
    await save()

    const comparisons = []
    for (const surface of ["drawer", "modal"]) {
        await page.evaluate((surface) => window.profileUi.inspectSelf(surface), surface)
        const dialog = page.getByRole("dialog", { name: "Профиль alex", exact: true })
        const realCard = dialog.getByRole("article", { name: "Карточка alex", exact: true })
        await realCard.waitFor()
        assert.equal(
            await dialog.getByRole("button", { name: "Заблокировать", exact: true }).count(),
            1,
            "Card is viewed as a friend"
        )
        assert.equal(await preview.innerText(), await realCard.innerText())
        const visualData = (element) => ({
            effects: Array.from(element.querySelectorAll("[data-effect]")).map((node) =>
                node.getAttribute("data-effect")
            ),
            images: Array.from(element.querySelectorAll("img")).map((img) => img.getAttribute("src")),
            typography: Array.from(element.querySelectorAll("h2,p")).map((node) => {
                const css = getComputedStyle(node)
                return { font: css.font, color: css.color, lineHeight: css.lineHeight, whiteSpace: css.whiteSpace }
            })
        })
        assert.deepEqual(await preview.evaluate(visualData), await realCard.evaluate(visualData))
        const bounds = await realCard.boundingBox()
        const actual = await snapshotCard(realCard, bounds.width, `friend-${surface}-card.png`)
        await screenshot(`friend-${surface}`)
        await page.evaluate(() => window.profileUi.inspectSelf(null))
        await dialog.waitFor({ state: "detached" })
        await preview.scrollIntoViewIfNeeded()
        const expected = await snapshotCard(preview, bounds.width, `preview-for-${surface}.png`)
        const difference = await comparePixels(page, expected, actual)
        comparisons.push({ surface, ...difference })
        assert.equal(difference.sizeMismatch, undefined, `${surface}: preview must have the same geometry`)
        assert.ok(
            difference.badRatio < 0.025 && difference.meanError < 1.5,
            `${surface}: preview must visually match the real card: ${JSON.stringify(difference)}`
        )
    }
    console.log(JSON.stringify({ cardComparisons: comparisons }))

    await status.fill("")
    await bio.fill("")
    assert.equal(await preview.getByText("Нет статуса", { exact: true }).count(), 1)
    assert.equal(await preview.getByText("Пользователь пока ничего не написал о себе.", { exact: true }).count(), 1)
    await save()
    await screenshot("quiet-profile-empty")
    await status.fill("На связи после 19:00")
    await bio.fill("Вечером — в голосовом. Люблю кооперативы, музыку и долгие разговоры.")
    await save()
    await page.getByRole("status").filter({ hasText: "Сохранено" }).waitFor({ state: "detached" })
    for (const [width, height] of [
        [1440, 1000],
        [1024, 900],
        [800, 700],
        [600, 800]
    ]) {
        await page.setViewportSize({ width, height })
        await page.getByRole("tab", { name: "Оформление", exact: true }).click()
        await page.getByRole("tab", { name: "Профиль", exact: true }).click()
        await screenshot(`quiet-profile-${width}`)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await preview.scrollIntoViewIfNeeded()
        await screenshot(`quiet-profile-card-${width}`)
        assert.equal(await preview.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
    }
    await bio.fill("Оченьдлинноесловобезпробелов".repeat(35))
    await preview.scrollIntoViewIfNeeded()
    assert.equal(await preview.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
    await screenshot("quiet-profile-long-description")
    await page.getByRole("tab", { name: "Оформление", exact: true }).click()
    await page.getByRole("button", { name: "Превью для друзей", exact: true }).click()
    const appearancePreview = page.getByRole("dialog", { name: "Карточка у друзей", exact: true })
    await appearancePreview.getByText("Так будет выглядеть профиль после сохранения.", { exact: true }).waitFor()
    assert.equal(await appearancePreview.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
    const modalBounds = await appearancePreview.boundingBox()
    assert.ok(modalBounds.y >= 0 && modalBounds.y + modalBounds.height <= 800)
    await screenshot("appearance-preview-long-description")
    await appearancePreview.getByRole("button", { name: "Закрыть", exact: true }).first().click()
    await appearancePreview.waitFor({ state: "detached" })

    await page.setViewportSize({ width: 1280, height: 860 })
    await page.getByRole("tab", { name: "Оформление", exact: true }).click()
    await page.getByRole("radiogroup", { name: "Аватар", exact: true }).waitFor()
    await page.getByRole("tab", { name: "Аккаунт", exact: true }).click()
    await page.getByRole("heading", { name: "Резервная копия", exact: true }).waitFor()
    await screenshot("account")
    await page.getByRole("tab", { name: "Профиль", exact: true }).click()
    for (const plan of ["free", "medium", "pro"]) {
        await page.evaluate((plan) => window.profileUi.setPlan(plan), plan)
        await preview.waitFor()
        const effects = await preview
            .locator("[data-effect]")
            .evaluateAll((elements) => elements.map((el) => el.getAttribute("data-effect")))
        assert.deepEqual(effects, plan === "pro" ? ["sakura", "orbit"] : ["none", "orbit"])
    }
}

module.exports = { checkQuietProfile }
