const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const crypto = require("node:crypto")
const { promisify } = require("node:util")
const { execFile } = require("node:child_process")
const { createRequire } = require("node:module")
const { pathToFileURL } = require("node:url")
const { chromium } = require("playwright")
const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const siteRequire = createRequire(path.join(root, "apps/site/package.json"))
const exec = promisify(execFile)
const output = path.resolve(process.env.BILLING_UI_OUTPUT || "artifacts/billing-checkout-ui")
const containers = [],
    screenshots = [],
    requests = [],
    errors = [],
    scenarios = []
let pool, redis, vite, server, browser, temporary, service
let nextMode = "pending",
    dropResponse = false,
    createCalls = 0,
    getCalls = 0
const payments = new Map()
const billingMode = process.env.BILLING_UI_MODE || "test"
assert(["test", "live"].includes(billingMode), "Only explicit local billing test modes are supported")
const fixtureSecret = `${billingMode}_isolated-not-real-provider-secret`
const successTitle = billingMode === "test" ? "Тестовая оплата подтверждена" : "План подключён"
const pendingTitle = billingMode === "test" ? "Ожидаем тестовую оплату" : "Ожидаем оплату"
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function eventually(check, label, timeout = 20000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
        if (await check()) return
        await wait(75)
    }
    throw new Error("Timed out: " + label)
}
async function capture(page, name) {
    await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true })
    screenshots.push(name + ".png")
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No horizontal overflow")
}
async function sourceHashes() {
    const hashes = {}
    async function walk(directory) {
        for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
            const file = path.posix.join(directory, entry.name)
            if (entry.isDirectory()) await walk(file)
            else if (/\.(?:tsx?|css)$/.test(file))
                hashes[file] = crypto
                    .createHash("sha256")
                    .update(await fs.readFile(path.join(root, file)))
                    .digest("hex")
        }
    }
    await walk("apps/site/src")
    await walk("apps/gateway/billing")
    return hashes
}
;(async () => {
    await fs.mkdir(output, { recursive: true })
    const startHashes = await sourceHashes()
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-billing-ui-"))
    const docker = async (...args) => (await exec("docker", args, { timeout: 60000 })).stdout.trim()
    assert.match(await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}"), /^unix:\/\//)
    const suffix = crypto.randomBytes(5).toString("hex"),
        password = crypto.randomBytes(24).toString("hex")
    for (const [kind, image, port, extra] of [
        [
            "pg",
            "postgres:15-alpine",
            "5432",
            [
                "-e",
                "POSTGRES_USER=playtime_test",
                "-e",
                "POSTGRES_DB=playtime_test",
                "-e",
                `POSTGRES_PASSWORD=${password}`
            ]
        ],
        ["redis", "redis:7-alpine", "6379", []]
    ])
        containers.push(
            await docker(
                "run",
                "--rm",
                "-d",
                "--name",
                `playtime-billing-${kind}-${suffix}`,
                "--label",
                "playtime.qa=billing-ui",
                "-p",
                `127.0.0.1::${port}`,
                ...extra,
                image,
                ...(kind === "redis"
                    ? ["redis-server", "--save", "", "--appendonly", "no", "--requirepass", password]
                    : [])
            )
        )
    const port = async (id, target) =>
        Number(
            await docker(
                "inspect",
                "--format",
                `{{(index (index .NetworkSettings.Ports "${target}/tcp") 0).HostPort}}`,
                id
            )
        )
    const [pgPort, redisPort] = await Promise.all([port(containers[0], 5432), port(containers[1], 6379)])
    await fs.writeFile(path.join(temporary, "empty.env"), "")
    Object.assign(process.env, {
        NODE_ENV: "test",
        DOTENV_CONFIG_PATH: path.join(temporary, "empty.env"),
        PG_HOST: "127.0.0.1",
        PG_PORT: String(pgPort),
        PG_USER: "playtime_test",
        PG_DATABASE: "playtime_test",
        PG_PASSWORD: password,
        REDIS_URL: `redis://:${password}@127.0.0.1:${redisPort}/0`,
        JWT_SECRET_ENV: "isolated-billing-ui-not-production",
        YOOKASSA_MODE: billingMode,
        YOOKASSA_SHOP_ID: "12345",
        YOOKASSA_SECRET_KEY: fixtureSecret,
        SITE_ORIGIN: billingMode === "live" ? "https://shop.example.test" : "http://127.0.0.1"
    })
    require("tsx/cjs")
    ;({ pool, redis } = require("../../apps/shared/config.ts"))
    redis.on("error", () => {})
    await eventually(async () => {
        try {
            await pool.query("SELECT 1")
            return (await redis.ping()) === "PONG"
        } catch {
            return false
        }
    }, "isolated databases")
    await pool.query(await fs.readFile(path.join(root, "apps/database/schema.sql"), "utf8"))
    for (const name of (await fs.readdir(path.join(root, "apps/database/migrations")))
        .filter((name) => name.endsWith(".sql"))
        .sort())
        await pool.query(await fs.readFile(path.join(root, "apps/database/migrations", name), "utf8"))
    await pool.query(
        "INSERT INTO users(id,username,email,password_hash,email_verified_at) VALUES(1,'alex','alex@example.test','test-only',NOW())"
    )
    const { BillingService } = require("../../apps/gateway/billing/orderService.ts")
    const config = {
        mode: billingMode,
        shopId: "12345",
        secretKey: fixtureSecret,
        returnUrl: "http://127.0.0.1/playtime/checkout"
    }
    service = new BillingService({
        pool,
        config: () => config,
        provider: () => ({
            async create(request, idempotenceKey) {
                createCalls++
                let item = [...payments.values()].find((item) => item.key === idempotenceKey)
                if (!item) {
                    item = {
                        key: idempotenceKey,
                        mode: nextMode,
                        request,
                        payment: {
                            id: crypto.randomUUID(),
                            status: "pending",
                            paid: false,
                            test: billingMode === "test",
                            amount: request.amount,
                            recipient: { account_id: config.shopId },
                            metadata: request.metadata,
                            confirmation: {
                                type: "redirect",
                                confirmation_url: `https://yoomoney.ru/checkout/qa?order=${idempotenceKey}`
                            }
                        }
                    }
                    payments.set(item.payment.id, item)
                }
                if (item.mode === "creating") throw new Error("isolated provider unavailable")
                return item.payment
            },
            async get(id) {
                getCalls++
                return payments.get(id).payment
            }
        })
    })
    const express = backendRequire("express"),
        app = express()
    const accountToken = crypto.randomUUID()
    const { configureBearerAccess } = require("../../apps/shared/http/bearerAuth.ts")
    configureBearerAccess(app, async (token) => token === accountToken
        ? { kind: "allowed", session: { id: 1, username: "alex" } }
        : { kind: "invalid" })
    app.use((req, res, next) => {
        if (req.path.startsWith("/playtime/billing"))
            requests.push({ method: req.method, path: req.path, authorization: !!req.headers.authorization })
        if (req.method === "POST" && req.path === "/playtime/billing/orders" && dropResponse) {
            const json = res.json.bind(res)
            res.json = (body) => {
                if (res.statusCode < 300) {
                    res.destroy()
                    return res
                }
                return json(body)
            }
        }
        next()
    })
    const { createBillingRouter } = require("../../apps/gateway/routes/billing.ts")
    app.use("/playtime/billing", createBillingRouter(service))
    const { listPlansPublic } = require("../../apps/shared/subscription/planCatalog.ts")
    app.get("/playtime/subscription/plans", (_req, res) => res.json({ plans: listPlansPublic() }))
    app.post("/playtime/site-analytics/visit", (_req, res) => res.sendStatus(204))
    app.get("/playtime/releases/latest", (_req, res) => res.status(404).json({ error: "no fixture release" }))
    server = await new Promise((resolve) => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance))
    })
    process.env.VITE_PROXY_TARGET = `http://127.0.0.1:${server.address().port}`
    let base
    if (process.env.BILLING_SITE_DIST) {
        const directory = path.resolve(process.env.BILLING_SITE_DIST)
        app.use("/playtime", express.static(directory))
        app.get(/^\/playtime\/(?:checkout|legal\/(?:terms|privacy))?$/, (_req, res) =>
            res.sendFile(path.join(directory, "index.html"))
        )
        base = process.env.VITE_PROXY_TARGET + "/playtime"
    } else {
        const { createServer } = await import(pathToFileURL(siteRequire.resolve("vite")).href)
        vite = await createServer({
            root: path.join(root, "apps", "site"),
            configFile: path.join(root, "apps/site/vite.config.ts"),
            cacheDir: path.join(temporary, "vite-cache"),
            server: { host: "127.0.0.1", port: 0, open: false }
        })
        await vite.listen()
        base = `http://127.0.0.1:${vite.httpServer.address().port}/playtime`
    }
    config.returnUrl = base + "/checkout"
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    await context.route("https://yoomoney.ru/**", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><h1>Isolated official-host provider boundary</h1>"
        })
    )
    await context.route("https://**/*", (route) =>
        route.request().url().startsWith("https://yoomoney.ru/") ? route.fallback() : route.abort()
    )
    const page = await context.newPage()
    page.on("pageerror", (error) => errors.push(error.message))
    const verifyAccount = async () => {
        const back = page.getByRole("link", { name: "К тарифам", exact: true })
        await back.waitFor({ state: "visible" })
        assert.equal(await back.locator("svg").count(), 1, "Back navigation uses an SVG icon")
        assert(!(await back.innerText()).includes("←"), "No text arrow glyph")
        assert(
            !/ЮKassa|сервере|После возврата|Никнейм в PlayTime|Почта этого аккаунта/.test(
                await page.locator("body").innerText()
            ),
            "Customer checkout has no implementation copy"
        )
        await page.getByText("alex", { exact: true }).waitFor()
        await page.getByText(/alex@example.test/).waitFor()
    }
    const submit = () =>
        page
            .getByRole("button", { name: billingMode === "test" ? /^Перейти к тестовой оплате/ : /^Перейти к оплате/ })
            .click()
    const latest = async () =>
        (await pool.query("SELECT * FROM billing_orders ORDER BY created_at DESC LIMIT 1")).rows[0]
    const returnTo = async (order) => {
        await page.goto(base + "/checkout?order=" + order.id)
        await page.getByRole("heading", { name: pendingTitle }).waitFor()
    }
    const settle = async (order, status) => {
        const item = payments.get(order.provider_id)
        item.payment = { ...item.payment, status, paid: status === "succeeded", confirmation: undefined }
        await pool.query("UPDATE billing_orders SET next_check_at=NOW() WHERE id=$1", [order.id])
        await service.tick()
    }
    await page.goto(base + "/#plans")
    await page.getByRole("link", { name: "Купить Pro", exact: true }).waitFor()
    await page.locator("#plans").scrollIntoViewIfNeeded()
    await capture(page, "01-desktop-plans")
    await page.getByRole("link", { name: "Купить Pro", exact: true }).click()
    await page.getByRole("link", { name: "Войти в PlayTime" }).waitFor()
    assert.equal(await page.getByRole("button", { name: /^Перейти к/ }).isDisabled(), true)
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM billing_orders")).rows[0].count), 0)
    await capture(page, "02-desktop-sign-in")
    await page.evaluate((token) => localStorage.setItem("token", token), accountToken)
    await page.getByRole("button", { name: "Проверить аккаунт" }).click()
    await verifyAccount()
    await capture(page, "03-verified-checkout-account")
    scenarios.push("checkout requires login and displays the signed-in account")
    dropResponse = true
    await submit()
    await page.getByRole("heading", { name: "Ожидаем подтверждения оплаты" }).waitFor()
    dropResponse = false
    const lost = await latest(),
        before = createCalls
    await capture(page, "04-lost-create-response")
    await page.reload()
    await page.getByRole("heading", { name: "Ожидаем подтверждения оплаты" }).waitFor()
    const savedBeforeLimit = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("playtime_checkout_attempts_v1")).find((item) => !item.orderId)
    )
    await redis.set("billing:budget:create:global", "120", "EX", 2)
    await page.getByRole("button", { name: "Проверить статус", exact: true }).click()
    await page.getByRole("button", { name: /Повторить через/ }).waitFor()
    await capture(page, "04b-lost-response-rate-limited")
    assert.equal(await page.getByRole("form").count(), 0, "Rate limiting never unlocks an uncertain payment form")
    await page.reload()
    await page.getByRole("heading", { name: "Ожидаем подтверждения оплаты" }).waitFor()
    const savedAfterLimit = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("playtime_checkout_attempts_v1")).find((item) => !item.orderId)
    )
    assert.equal(savedAfterLimit.requestId, savedBeforeLimit.requestId)
    assert.equal(savedAfterLimit.statusToken, savedBeforeLimit.statusToken)
    assert(savedAfterLimit.retryAt > 0, "Retry-After survives reload")
    await page.getByRole("button", { name: "Проверить статус", exact: true }).waitFor({ timeout: 5000 })
    await page.getByRole("button", { name: "Проверить статус", exact: true }).click()
    await page.waitForURL("https://yoomoney.ru/**")
    assert.equal(createCalls, before, "Lost POST response reused existing order and provider idempotence")
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM billing_orders")).rows[0].count), 1)
    scenarios.push(
        "lost create response then429/reload retains exact persisted UUID/token and cooldown without another order"
    )
    await returnTo(lost)
    await capture(page, "05-return-pending")
    assert.equal(
        Number((await pool.query("SELECT COUNT(*) FROM billing_entitlements")).rows[0].count),
        0,
        "Provider return is not payment proof"
    )
    await settle(lost, "succeeded")
    await page.getByRole("heading", { name: successTitle }).waitFor({ timeout: 20000 })
    await capture(page, "06-desktop-server-granted")
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM billing_entitlements")).rows[0].count), 1)
    await page.reload()
    await page.getByText(billingMode === "test" ? /Тестовый Pro активирован до/ : /План Pro активирован до/).waitFor()
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM billing_entitlements")).rows[0].count), 1)
    scenarios.push("only server verified succeeded + applied grant renders success; reload grants exactly once")
    const missing = await browser.newContext({ viewport: { width: 390, height: 844 } }),
        missingPage = await missing.newPage()
    await missingPage.goto(base + "/checkout?order=" + lost.id + "&status=succeeded")
    await missingPage.getByRole("heading", { name: "Откройте исходную вкладку" }).waitFor()
    await capture(missingPage, "07-return-without-capability")
    assert.equal(await missingPage.getByText(/активирован до/).count(), 0)
    await missing.close()
    scenarios.push("copied/tampered return URL without session capability cannot show payment or grant")
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(base + "/checkout?plan=medium")
    await verifyAccount()
    await capture(page, "08-mobile-form")
    await submit()
    await page.waitForURL("https://yoomoney.ru/**")
    const canceled = await latest()
    await returnTo(canceled)
    await settle(canceled, "canceled")
    await page.getByRole("heading", { name: "Платёж отменён", exact: true }).waitFor()
    await capture(page, "09-mobile-canceled")
    await page
        .getByRole("button", { name: billingMode === "test" ? "Начать новую тестовую оплату" : "Начать новую оплату" })
        .click()
    await verifyAccount()
    await submit()
    await page.waitForURL("https://yoomoney.ru/**")
    const second = await latest()
    assert.notEqual(second.request_id, canceled.request_id)
    await returnTo(second)
    await settle(second, "succeeded")
    await page.getByRole("heading", { name: successTitle }).waitFor()
    await capture(page, "10-mobile-server-granted")
    scenarios.push("mobile cancellation permits explicit new UUID; verified second payment activates monthly plan")
    const proof = await page.evaluate(() => JSON.parse(sessionStorage.getItem("playtime_checkout_attempts_v1")))
    const token = proof.find((item) => item.orderId === second.id).statusToken
    assert(!page.url().includes(token))
    const unauthorized = await fetch(process.env.VITE_PROXY_TARGET + "/playtime/billing/orders/" + second.id, {
        headers: { Authorization: "Bearer " + crypto.randomBytes(32).toString("base64url") }
    })
    assert.equal(unauthorized.status, 404)
    assert.equal(unauthorized.headers.get("cache-control"), "no-store")
    await page.goto(base + "/checkout?plan=enterprise")
    nextMode = "creating"
    await verifyAccount()
    await submit()
    await page
        .getByRole("heading", {
            name: billingMode === "test" ? "Готовим тестовый платёж" : "Готовим платёж",
            exact: true
        })
        .waitFor()
    await capture(page, "11-mobile-creating")
    const review = await latest()
    await pool.query("UPDATE billing_orders SET state='review',confirmation_url=NULL WHERE id=$1", [review.id])
    await page.getByRole("button", { name: "Проверить статус", exact: true }).click()
    await page.getByRole("heading", { name: "Платёж проверяется", exact: true }).waitFor()
    await capture(page, "12-mobile-review")
    assert.equal(
        await page
            .getByRole("button", {
                name: billingMode === "test" ? "Начать новую тестовую оплату" : "Начать новую оплату"
            })
            .count(),
        0
    )
    await pool.query("UPDATE billing_orders SET access_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [review.id])
    await page.getByRole("button", { name: "Проверить статус", exact: true }).click()
    await page.getByRole("heading", { name: "Не удалось подтвердить оплату", exact: true }).waitFor()
    await capture(page, "13-mobile-expired")
    scenarios.push("uncertain creation, review and expired remain non-success and prevent automatic second payment")
    nextMode = "pending"
    await page.setViewportSize({ width: 320, height: 740 })
    await page.goto(base + "/checkout?plan=medium")
    await verifyAccount()
    await capture(page, "14-small-mobile-form")
    await page.setViewportSize({ width: 844, height: 390 })
    await capture(page, "15-landscape-form")
    const budgetKeys = await redis.keys("billing:budget:create:*")
    if (budgetKeys.length) await redis.del(...budgetKeys)
    await redis.set("billing:budget:create:global", "120", "EX", 1)
    await submit()
    await page.getByRole("button", { name: /Повторить через/ }).waitFor()
    await page.getByRole("heading", { name: "Ожидаем подтверждения оплаты" }).waitFor()
    await page.getByRole("button", { name: "Проверить статус", exact: true }).waitFor({ timeout: 5000 })
    await page.getByRole("button", { name: "Проверить статус", exact: true }).click()
    await page.waitForURL("https://yoomoney.ru/**")
    const resumable = await latest()
    await returnTo(resumable)
    await page.clock.install()
    await page.clock.fastForward(121000)
    await page.getByText(/Оплата ещё в обработке/).waitFor()
    await capture(page, "16-bounded-poll-paused")
    const requestsBeforeResume = requests.length
    await page.getByRole("button", { name: "Проверить статус", exact: true }).click()
    await eventually(() => requests.length > requestsBeforeResume, "explicit paused polling resume")
    await page.getByText(/Оплата ещё в обработке/).waitFor({ state: "hidden" })
    await page.clock.resume()
    await settle(resumable, "succeeded")
    await page.getByRole("heading", { name: successTitle }).waitFor({ timeout: 20000 })
    scenarios.push(
        "320px and landscape remain usable; Retry-After countdown releases; bounded polling pauses and explicitly resumes"
    )
    if (billingMode === "live") {
        assert(
            !/Тестов(?:ая|ый|ую)/.test(await page.locator("body").innerText()),
            "Live checkout must not claim test payment"
        )
        await page
            .getByText(/Без автопродления/)
            .first()
            .waitFor()
    }
    const endHashes = await sourceHashes()
    assert.deepEqual(endHashes, startHashes, "Source unchanged throughout actual UI test")
    assert.deepEqual(errors, [])
    const counts = (
        await pool.query(
            "SELECT (SELECT COUNT(*) FROM billing_orders)::int AS orders,(SELECT COUNT(*) FROM billing_entitlements)::int AS entitlements"
        )
    ).rows[0]
    const report = {
        passed: true,
        billingMode,
        productionBuiltSite: !!process.env.BILLING_SITE_DIST,
        isolatedProvider: true,
        realRouterServicePostgresRedis: true,
        scenarios,
        screenshots,
        createCalls,
        getCalls,
        counts,
        requests,
        pageErrors: errors,
        sourceHashes: startHashes
    }
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 4))
    await fs.rm(path.join(output, "failure.json"), { force: true })
    console.log(JSON.stringify({ passed: true, scenarios: scenarios.length, screenshots: screenshots.length, counts }))
})()
    .catch(async (error) => {
        console.error(error.stack || error)
        for (const context of browser?.contexts() || []) {
            for (const page of context.pages())
                await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {})
        }
        await fs.mkdir(output, { recursive: true })
        await fs.writeFile(
            path.join(output, "failure.json"),
            JSON.stringify({ error: String(error), screenshots, requests, errors }, null, 4)
        )
        process.exitCode = 1
    })
    .finally(async () => {
        await browser?.close().catch(() => {})
        await vite?.close().catch(() => {})
        if (server) await new Promise((resolve) => server.close(resolve))
        await pool?.end().catch(() => {})
        await redis?.quit().catch(() => {})
        for (const id of containers) await exec("docker", ["rm", "-f", id], { timeout: 30000 }).catch(() => {})
        if (temporary) await fs.rm(temporary, { recursive: true, force: true })
    })
