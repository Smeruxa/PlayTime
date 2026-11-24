const assert = require("node:assert/strict")
const path = require("node:path")
const fs = require("node:fs/promises")

function createAccountApi() {
    const api = {
        sessions: [
            {
                id: "this-device",
                deviceName: "MacBook Pro",
                current: true,
                createdAt: "2026-11-01T10:00:00Z",
                lastSeenAt: "2026-11-02T19:00:00Z"
            },
            {
                id: "other-device",
                deviceName: "Домашний компьютер",
                current: false,
                createdAt: "2026-10-30T10:00:00Z",
                lastSeenAt: "2026-11-01T18:40:00Z"
            }
        ],
        calls: [],
        failNextLoad: false,
        challengeTarget: null,
        bundle: null,
        async handle(route) {
            const request = route.request()
            const pathname = new URL(request.url()).pathname.replace(/^\/playtime/, "")
            if (!pathname.startsWith("/auth/sessions") && !pathname.startsWith("/auth/key-transfer")) return false
            const method = request.method()
            const data = request.postDataJSON()
            api.calls.push({ pathname, method, data })
            const reply = (body, status = 200) =>
                route.fulfill({
                    status,
                    contentType: "application/json",
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "Authorization, Content-Type",
                        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
                    },
                    body: JSON.stringify(body)
                })
            if (method === "OPTIONS") await reply({})
            else if (pathname === "/auth/sessions" && method === "GET") {
                if (api.failNextLoad) {
                    api.failNextLoad = false
                    await reply({ error: "Не удалось загрузить устройства" }, 503)
                } else await reply({ sessions: api.sessions })
            } else if (pathname.endsWith("/revocation-code")) {
                api.challengeTarget = data
                await reply({
                    challengeId: "fixture-challenge",
                    email: "alex@example.test",
                    expiresAt: new Date(Date.now() + 600000).toISOString(),
                    retryAfter: 60
                })
            } else if (pathname.endsWith("/revoke") || pathname.endsWith("/revoke-others")) {
                if (data.code !== "012345") await reply({ error: "Неверный код подтверждения" }, 400)
                else {
                    api.sessions = api.sessions.filter((device) => device.current)
                    await reply({ success: true })
                }
            } else if (/\/key-transfer\/?$/.test(pathname)) {
                api.bundle = data
                await reply({ id: "fixture-transfer" })
            } else if (pathname.endsWith("/consume")) await reply(api.bundle)
            else await reply({ error: "Unexpected fixture request" }, 404)
            return true
        }
    }
    return api
}

async function checkAccountPage(page, output, api) {
    const tab = page.getByRole("tab", { name: "Аккаунт", exact: true })
    const panel = page.getByRole("tabpanel")
    const screenshot = async (name) => {
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(output, name + ".png") })
    }
    const close = async () => {
        await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).first().click()
        await page.getByRole("dialog").waitFor({ state: "detached" })
    }
    const remount = async () => {
        await page.getByRole("tab", { name: "Профиль", exact: true }).click()
        await tab.click()
    }
    await tab.click()
    await panel.getByText("2 сеанса", { exact: true }).waitFor()
    assert.equal(await page.getByRole("heading", { name: "Аккаунт", exact: true }).count(), 1)
    assert.equal(await page.getByRole("heading", { name: "Профиль", exact: true }).count(), 0)
    assert.equal(await panel.locator("img").count(), 0)
    assert.equal(await panel.getByText("alex@example.test", { exact: true }).count(), 0)
    await screenshot("account-1280")
    for (const [width, height] of [
        [1440, 1000],
        [1024, 800],
        [800, 800],
        [600, 900]
    ]) {
        await page.setViewportSize({ width, height })
        await screenshot(`account-${width}`)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    await page.setViewportSize({ width: 1280, height: 860 })
    const passwordTrigger = panel.getByRole("button", { name: "Изменить пароль", exact: true })
    await passwordTrigger.click()
    let modal = page.getByRole("dialog", { name: "Изменить пароль", exact: true })
    await modal.getByLabel("Текущий пароль", { exact: true }).fill("wrong-password")
    await modal.getByLabel("Новый пароль", { exact: true }).fill("new-test-password")
    await modal.getByLabel("Повторите новый пароль", { exact: true }).fill("other-test-password")
    await modal.getByRole("button", { name: "Изменить пароль", exact: true }).click()
    await modal.getByRole("alert").filter({ hasText: "Новые пароли не совпадают" }).waitFor()
    assert.equal((await page.evaluate(() => window.profileUi.accountActions)).length, 0)
    await modal.getByLabel("Повторите новый пароль", { exact: true }).fill("new-test-password")
    await modal.getByRole("button", { name: "Изменить пароль", exact: true }).click()
    await modal.getByRole("alert").filter({ hasText: "Неверный пароль" }).waitFor()
    await screenshot("password-error")
    await modal.getByLabel("Текущий пароль", { exact: true }).fill("current-test-password")
    await modal.getByRole("button", { name: "Изменить пароль", exact: true }).click()
    await modal.getByRole("status").filter({ hasText: "Пароль изменён" }).waitFor()
    await screenshot("password-saved")
    await close()
    assert.equal(await passwordTrigger.evaluate((el) => el === document.activeElement), true)
    await passwordTrigger.click()
    assert.equal(await page.getByLabel("Текущий пароль", { exact: true }).inputValue(), "")
    await close()
    await panel.getByRole("button", { name: "Сохранить", exact: true }).click()
    modal = page.getByRole("dialog", { name: "Сохранить резервную копию", exact: true })
    assert.equal(await modal.getByRole("button", { name: "Сохранить копию", exact: true }).isDisabled(), true)
    await modal.getByLabel("Пароль резервной копии", { exact: true }).fill("backup-test-password")
    await screenshot("backup-form")
    const downloadEvent = page.waitForEvent("download")
    await modal.getByRole("button", { name: "Сохранить копию", exact: true }).click()
    const download = await downloadEvent
    const backupPath = path.join(output, "isolated-test-backup.json")
    await download.saveAs(backupPath)
    const contents = await fs.readFile(backupPath, "utf8")
    assert.equal(JSON.parse(contents).format, "playtime-key-backup-v1")
    assert.equal(contents.includes(Buffer.alloc(32, 7).toString("base64")), false)
    await modal.getByRole("status").filter({ hasText: "Копия сохранена" }).waitFor()
    await close()
    await panel.getByRole("button", { name: "Восстановить", exact: true }).click()
    modal = page.getByRole("dialog", { name: "Восстановить из копии", exact: true })
    const fileInput = modal.locator('input[type="file"]')
    await fileInput.setInputFiles({ name: "wrong.txt", mimeType: "text/plain", buffer: Buffer.from("test") })
    await modal.getByRole("alert").filter({ hasText: "формате .json" }).waitFor()
    await fileInput.setInputFiles(backupPath)
    await modal.getByLabel("Пароль от копии", { exact: true }).fill("wrong-backup-password")
    await modal.getByRole("button", { name: "Восстановить", exact: true }).click()
    await modal.getByRole("alert").filter({ hasText: "проверьте пароль" }).waitFor()
    await modal.getByLabel("Пароль от копии", { exact: true }).fill("backup-test-password")
    await screenshot("restore-form")
    await modal.getByRole("button", { name: "Восстановить", exact: true }).click()
    await modal.getByRole("status").filter({ hasText: "Ключи восстановлены" }).waitFor()
    await close()
    await panel.getByRole("button", { name: "Подключить устройство", exact: true }).click()
    modal = page.getByRole("dialog", { name: "Переписка на другом устройстве", exact: true })
    await screenshot("transfer-form")
    await modal.getByRole("button", { name: "Создать одноразовый код", exact: true }).click()
    const code = modal.getByLabel("Код переноса", { exact: true })
    await code.waitFor()
    const generated = await code.inputValue()
    assert.match(generated, /^fixture-transfer\./)
    assert.equal(api.bundle.ciphertext.includes(Buffer.alloc(32, 7).toString("base64")), false)
    await screenshot("transfer-code")
    await modal.getByRole("button", { name: "Получить на этом", exact: true }).click()
    await modal.getByLabel("Код с первого устройства", { exact: true }).fill("invalid")
    await modal.getByRole("button", { name: "Перенести на этот компьютер", exact: true }).click()
    await modal.getByRole("alert").filter({ hasText: "полный код" }).waitFor()
    await modal.getByLabel("Код с первого устройства", { exact: true }).fill(generated)
    page.once("dialog", (dialog) => dialog.accept())
    await modal.getByRole("button", { name: "Перенести на этот компьютер", exact: true }).click()
    await modal.getByRole("status").filter({ hasText: "Ключи перенесены" }).waitFor()
    await close()
    await panel.getByRole("button", { name: "Завершить", exact: true }).click()
    modal = page.getByRole("dialog", { name: "Завершить сеанс?", exact: true })
    await modal.getByRole("button", { name: "Отправить код на почту", exact: true }).click()
    const otp = modal.getByLabel("Код из письма · 6 цифр", { exact: true })
    await otp.fill("000000")
    await modal.getByRole("button", { name: "Подтвердить отключение", exact: true }).click()
    await modal.getByRole("alert").filter({ hasText: "Неверный код" }).waitFor()
    await screenshot("session-wrong-code")
    assert.deepEqual(api.challengeTarget, { sessionId: "other-device" })
    await otp.fill("012345")
    await screenshot("session-confirmation")
    await modal.getByRole("button", { name: "Подтвердить отключение", exact: true }).click()
    await modal.waitFor({ state: "detached" })
    await panel.getByText("1 сеанс", { exact: true }).waitFor()
    await panel.getByRole("button", { name: "Удалить аккаунт", exact: true }).click()
    modal = page.getByRole("dialog", { name: "Удалить аккаунт?", exact: true })
    const hold = modal.getByRole("button", { name: "Удалить аккаунт: удерживайте 3 секунды", exact: true })
    assert.equal(await hold.getAttribute("aria-disabled"), "true")
    await modal.getByLabel("Пароль для подтверждения").fill("wrong-password")
    await screenshot("delete-confirmation")
    await hold.focus()
    await page.keyboard.down("Space")
    await page.waitForTimeout(400)
    await page.keyboard.up("Space")
    await page.keyboard.press("Escape")
    await page.waitForTimeout(3100)
    assert.equal(
        (await page.evaluate(() => window.profileUi.accountActions)).filter(
            (action) => action.event === "user:deleteAccount"
        ).length,
        0
    )
    await panel.getByRole("button", { name: "Удалить аккаунт", exact: true }).click()
    await page.getByLabel("Пароль для подтверждения").fill("wrong-password")
    await hold.focus()
    await page.keyboard.down("Space")
    await page.waitForTimeout(3200)
    await page.keyboard.up("Space")
    await modal.getByRole("alert").filter({ hasText: "Неверный пароль" }).waitFor()
    await close()
    api.failNextLoad = true
    await remount()
    await panel.getByRole("alert").filter({ hasText: "Не удалось загрузить" }).waitFor()
    await panel.getByRole("button", { name: "Повторить", exact: true }).click()
    await panel.getByText("1 сеанс", { exact: true }).waitFor()
    api.sessions.push(
        { id: "third-device", deviceName: "Ещё один компьютер", current: false, lastSeenAt: "2026-11-01T12:00:00Z" },
        { id: "fourth-device", deviceName: "Тестовый компьютер", current: false, lastSeenAt: "2026-11-01T12:00:00Z" }
    )
    await remount()
    await panel.getByText("3 сеанса", { exact: true }).waitFor()
    await panel.getByRole("button", { name: "Завершить остальные сеансы", exact: true }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Отправить код на почту", exact: true }).click()
    assert.deepEqual(api.challengeTarget, { allOthers: true })
    await close()
    api.sessions = []
    await remount()
    await panel.getByText("Активных устройств нет.", { exact: true }).waitFor()
    await screenshot("account-empty-devices")
    await fs.unlink(backupPath)
}

module.exports = { createAccountApi, checkAccountPage }
