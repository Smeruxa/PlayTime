const assert = require("node:assert/strict")
const path = require("node:path")
const fs = require("node:fs/promises")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const output = process.env.FEEDBACK_SCREENSHOT_DIR || "/private/tmp/playtime-feedback-ui"
const base = process.env.FEEDBACK_UI_URL || "http://127.0.0.1:4178/playtime"
let server, browser
;(async () => {
    const { createServer } = await import("vite")
    await fs.mkdir(output, { recursive: true })
    if (!process.env.FEEDBACK_UI_URL) {
        server = await createServer({
            root: path.resolve(__dirname, "../../apps/site"),
            configFile: path.resolve(__dirname, "../../apps/site/vite.config.ts"),
            server: { host: "127.0.0.1", port: 4178, strictPort: true, open: false, hmr: false, watch: null }
        })
        await server.listen()
    }
    browser = await chromium.launch({
        headless: true,
        ...(process.env.PROFILE_BROWSER_PATH ? { executablePath: process.env.PROFILE_BROWSER_PATH } : {})
    })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce" })
    const errors = [],
        external = [],
        submissions = [],
        mutations = []
    page.on("pageerror", (error) => errors.push(error.message))
    let submitMode = "ok",
        signedOut = false,
        conflict = false,
        sessionDeletes = 0
    const time = "2026-11-04T09:35:00Z"
    let tickets = [
        {
            id: "128",
            kind: "bug",
            title: "На macOS не перезапускается обновление",
            description:
                "После скачивания обновления нажимаю на перезапуск, но приложение остаётся открытым.\n\nОжидал, что PlayTime установит новую версию и откроется снова.",
            contact: "@alex",
            app_version: "2.0.11",
            platform: "macOS",
            status: "new",
            priority: "high",
            internal_note: "",
            revision: 1,
            created_at: time,
            updated_at: time
        },
        {
            id: "127",
            kind: "feature",
            title: "Тихий режим во время разговора",
            description: "Хочется отключать уведомления, когда мы играем и разговариваем с друзьями.",
            contact: "mira@example.test",
            app_version: "2.0.11",
            platform: "Windows",
            status: "planned",
            priority: "normal",
            internal_note: "Обсудить настройки уведомлений",
            revision: 1,
            created_at: time,
            updated_at: time
        },
        {
            id: "126",
            kind: "feature",
            title: "Больше эффектов для профиля",
            description: "Добавьте лёгкое свечение баннера и более спокойные эффекты аватара.",
            contact: "",
            app_version: "",
            platform: "",
            status: "done",
            priority: "low",
            internal_note: "",
            revision: 1,
            created_at: time,
            updated_at: time
        }
    ]
    await page.route("**/*", async (route) => {
        const request = route.request(),
            url = new URL(request.url())
        if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") {
            external.push(url.origin)
            return route.abort()
        }
        if (url.pathname.endsWith("/site-analytics/visit")) return route.fulfill({ status: 204 })
        if (url.pathname.endsWith("/feedback-api/challenge"))
            return route.fulfill({ json: { token: "isolated-fixture-token", cooldownSeconds: 900 } })
        if (url.pathname.endsWith("/feedback-api/tickets")) {
            submissions.push(request.postDataJSON())
            if (submitMode === "limit")
                return route.fulfill({
                    status: 429,
                    json: { error: "Заявка уже отправлена. Попробуйте позже.", retryAfter: 900 }
                })
            if (submitMode === "offline")
                return route.fulfill({ status: 503, json: { error: "Форма временно недоступна." } })
            return route.fulfill({ status: 201, json: { id: "129", cooldownSeconds: 900 } })
        }
        if (url.pathname.endsWith("/admin/access"))
            return route.fulfill({ status: signedOut ? 401 : 200, json: { allowed: !signedOut, clientIp: "192.0.2.1" } })
        if (url.pathname.endsWith("/admin/session")) {
            assert.equal(request.method(), "DELETE")
            assert.equal(request.headers()["x-playtime-admin"], "1")
            signedOut = true
            sessionDeletes += 1
            return route.fulfill({ status: 204 })
        }
        if (/\/admin\/tickets/.test(url.pathname)) {
            if (signedOut) return route.fulfill({ status: 401, json: { error: "Unauthorized" } })
            if (request.method() === "PATCH") {
                assert.equal(request.headers()["x-playtime-admin"], "1")
                const body = request.postDataJSON()
                mutations.push(body)
                if (conflict)
                    return route.fulfill({
                        status: 409,
                        json: { error: "Заявка уже изменена. Обновите список и откройте её снова." }
                    })
                const index = tickets.findIndex((ticket) => ticket.id === url.pathname.split("/").pop())
                tickets[index] = {
                    ...tickets[index],
                    status: body.status,
                    priority: body.priority,
                    internal_note: body.internalNote,
                    revision: tickets[index].revision + 1
                }
                return route.fulfill({ json: { ticket: tickets[index] } })
            }
            const filtered = tickets
                .filter((ticket) =>
                    ["status", "kind", "priority"].every(
                        (key) => !url.searchParams.get(key) || ticket[key] === url.searchParams.get(key)
                    )
                )
                .filter(
                    (ticket) => !url.searchParams.get("search") || ticket.title.includes(url.searchParams.get("search"))
                )
            return route.fulfill({ json: { tickets: filtered, nextCursor: null } })
        }
        return route.continue()
    })
    const goto = (path) => page.goto(`${base}${path}`)
    async function fill() {
        await page.getByRole("radio", { name: "Сообщить об ошибке" }).check()
        await page.getByRole("textbox", { name: "Тема", exact: true }).fill("Не работает обновление на macOS")
        await page
            .getByRole("textbox", { name: "Описание", exact: false })
            .fill("Нажимаю на перезапуск после загрузки обновления, но PlayTime остаётся открытым.")
        await page.getByRole("combobox", { name: /Устройство/ }).selectOption("macOS")
        await page.getByRole("textbox", { name: /Версия PlayTime/ }).fill("2.0.11")
        await page.getByRole("textbox", { name: /Как с вами связаться/ }).fill("@alex")
        await page.getByRole("button", { name: "Отправить", exact: true }).waitFor({ state: "visible" })
        await page.waitForFunction(() =>
            [...document.querySelectorAll("button")].some(
                (button) => button.textContent === "Отправить" && !button.disabled
            )
        )
    }
    for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1050 })
        await goto("/feedback")
        await page.getByRole("heading", { name: /Сделаем PlayTime/ }).waitFor()
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            `Form overflow at ${width}`
        )
        assert.equal(/[«»]/.test(await page.locator("body").innerText()), false)
        await page.waitForFunction(() =>
            [...document.querySelectorAll("button")].some(
                (button) => button.textContent === "Отправить" && !button.disabled
            )
        )
        await page.screenshot({ path: path.join(output, `feedback-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1050 })
    await goto("/feedback")
    await fill()
    submitMode = "offline"
    await page.getByRole("button", { name: "Отправить", exact: true }).click()
    await page.getByRole("alert").waitFor()
    assert.match(await page.getByRole("textbox", { name: "Тема", exact: true }).inputValue(), /macOS/)
    submitMode = "ok"
    await page.getByRole("button", { name: "Отправить", exact: true }).click()
    await page.getByRole("heading", { name: "Спасибо, получили." }).waitFor()
    assert.equal(
        await page.getByRole("heading", { name: "Спасибо, получили." }).evaluate((el) => el === document.activeElement),
        true
    )
    assert.equal(submissions[1].kind, "bug")
    assert.equal(submissions[1].website, "")
    await page.screenshot({ path: path.join(output, "feedback-success.png"), fullPage: true })
    await goto("/feedback")
    await fill()
    submitMode = "limit"
    await page.getByRole("button", { name: "Отправить", exact: true }).click()
    await page.getByRole("button", { name: /Повторить через/ }).waitFor()
    assert.equal(await page.getByRole("button", { name: /Повторить через/ }).isDisabled(), true)
    await goto("/admin/requests")
    const queue = page.getByRole("region", { name: "Список тикетов" })
    await queue.getByRole("button", { name: /На macOS/ }).click()
    const detail = page.getByRole("region", { name: "Заявка #128" })
    await detail.getByRole("combobox", { name: "Статус", exact: true }).selectOption("in_progress")
    await detail
        .getByRole("textbox", { name: "Внутренняя заметка" })
        .fill("Причина найдена: подпись macOS. Подготовить исправление.")
    await page.screenshot({ path: path.join(output, "tickets-admin-1440.png"), fullPage: true })
    assert.equal(await page.getByRole("button", { name: "Обновить", exact: true }).isDisabled(), true)
    await detail.getByRole("button", { name: "Сохранить", exact: true }).click()
    await page.getByRole("status").filter({ hasText: "Изменения сохранены" }).waitFor()
    await page.getByRole("heading", { name: "Тикеты", exact: true }).click()
    await page.screenshot({ path: path.join(output, "tickets-admin-1440.png"), fullPage: true })
    assert.equal(mutations[0].revision, 1)
    assert.equal(tickets[0].status, "in_progress")
    const filters = page.getByRole("form", { name: "Фильтры тикетов" })
    await filters.getByRole("combobox", { name: "Тип", exact: true }).selectOption("feature")
    await filters.getByRole("combobox", { name: "Статус", exact: true }).selectOption("planned")
    await filters.getByRole("textbox", { name: "Поиск" }).fill("Тихий")
    await filters.getByRole("button", { name: "Найти" }).click()
    await queue.getByRole("button", { name: /Тихий режим/ }).waitFor()
    assert.equal(await queue.getByRole("button", { name: /На macOS/ }).count(), 0)
    await queue.getByRole("button", { name: /Тихий режим/ }).click()
    const idea = page.getByRole("region", { name: "Заявка #127" })
    await idea.getByRole("textbox", { name: "Внутренняя заметка" }).fill("Не терять при конфликте")
    conflict = true
    await idea.getByRole("button", { name: "Сохранить", exact: true }).click()
    await page.getByRole("alert").filter({ hasText: "Заявка уже изменена" }).waitFor()
    assert.equal(
        await idea.getByRole("textbox", { name: "Внутренняя заметка" }).inputValue(),
        "Не терять при конфликте"
    )
    conflict = false
    await idea.getByRole("button", { name: "Отменить изменения" }).click()
    for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 950 })
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            `Admin overflow at ${width}`
        )
        await page.screenshot({ path: path.join(output, `tickets-admin-${width}.png`), fullPage: true })
    }
    await page.getByRole("button", { name: "Меню", exact: true }).click()
    await page.getByRole("button", { name: "Выйти из панели", exact: true }).click()
    await page.getByRole("heading", { name: "Доступ ограничен" }).waitFor()
    assert.equal(sessionDeletes, 1)
    assert.equal(await page.locator("input, textarea, form").count(), 0)
    assert.equal(await page.getByRole("button", { name: "Скопировать команду" }).count(), 0)
    assert.doesNotMatch(await page.locator("main").innerText(), /ключ|консол|DevTools|Console|команд|инструмент/i)
    await goto("/admin/requests")
    await page.getByText("Доступ к панели ограничен.", { exact: true }).waitFor()
    assert.equal(await page.getByRole("link", { name: "Перейти ко входу" }).count(), 1)
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    console.log(
        JSON.stringify({
            output,
            errors,
            external,
            sessionDeletes,
            checks: "form kinds, success, failed network preserves draft, cooldown, admin filters, save, optimistic conflict, private note, session logout, missing-session access, widths 1440/768/390/320"
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
