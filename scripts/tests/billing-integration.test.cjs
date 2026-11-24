const assert = require("node:assert/strict")
const { test } = require("node:test")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const crypto = require("node:crypto")
const { execFile } = require("node:child_process")
const { promisify } = require("node:util")
const { createRequire } = require("node:module")
const exec = promisify(execFile)
const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check) {
    for (let i = 0; i < 100; i++) {
        if (await check()) return
        await wait(50)
    }
    throw new Error("Isolated fixture did not settle")
}

test(
    "billing uses durable local transactions, verified payments and capability-protected HTTP",
    { timeout: 120000 },
    async (t) => {
        const containers = [],
            notifications = []
        let temporary, pool, redis, server
        try {
            temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-billing-test-"))
            const docker = async (...args) => (await exec("docker", args, { timeout: 60000 })).stdout.trim()
            assert.match(await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}"), /^unix:\/\//)
            const suffix = crypto.randomBytes(5).toString("hex"),
                password = crypto.randomBytes(24).toString("hex")
            containers.push(
                await docker(
                    "run",
                    "--rm",
                    "-d",
                    "--name",
                    `playtime-billing-pg-${suffix}`,
                    "--label",
                    "playtime.qa=billing",
                    "-p",
                    "127.0.0.1::5432",
                    "-e",
                    "POSTGRES_USER=playtime_test",
                    "-e",
                    "POSTGRES_DB=playtime_billing_test",
                    "-e",
                    `POSTGRES_PASSWORD=${password}`,
                    "postgres:15-alpine"
                )
            )
            containers.push(
                await docker(
                    "run",
                    "--rm",
                    "-d",
                    "--name",
                    `playtime-billing-redis-${suffix}`,
                    "--label",
                    "playtime.qa=billing",
                    "-p",
                    "127.0.0.1::6379",
                    "redis:7-alpine",
                    "redis-server",
                    "--save",
                    "",
                    "--appendonly",
                    "no",
                    "--requirepass",
                    password
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
                PG_DATABASE: "playtime_billing_test",
                PG_PASSWORD: password,
                REDIS_URL: `redis://:${password}@127.0.0.1:${redisPort}/0`,
                JWT_SECRET_ENV: "isolated-billing-transport-secret-not-production",
                YOOKASSA_MODE: "test",
                YOOKASSA_SHOP_ID: "12345",
                YOOKASSA_SECRET_KEY: "test_isolated-fake-provider-secret",
                SITE_ORIGIN: "https://shop.example.test"
            })
            require("tsx/cjs")
            ;({ pool, redis } = require("../../apps/shared/config.ts"))
            redis.on("error", () => {})
            await until(async () => {
                try {
                    await pool.query("SELECT 1")
                    return (await redis.ping()) === "PONG"
                } catch {
                    return false
                }
            })
            await pool.query(await fs.readFile(path.join(root, "apps/database/schema.sql"), "utf8"))
            for (const name of (await fs.readdir(path.join(root, "apps/database/migrations")))
                .filter((name) => name.endsWith(".sql"))
                .sort())
                await pool.query(await fs.readFile(path.join(root, "apps/database/migrations", name), "utf8"))
            await pool.query(
                "INSERT INTO users(id,username,email,password_hash,email_verified_at) VALUES(1,'alex','alex@example.test','fixture-only',NOW()),(2,'mira','mira@example.test','fixture-only',NOW())"
            )
            const { BillingService } = require("../../apps/gateway/billing/orderService.ts")
            const { readBillingConfig } = require("../../apps/gateway/billing/config.ts")
            const { addCalendarMonth } = require("../../apps/gateway/billing/entitlements.ts")
            const { effectivePaidPlan, getRoomPlanLimits } = require("../../apps/database/subscriptionPlans.ts")
            const { getPlanSlugForUser } = require("../../apps/gateway/subscription/subscriptionService.ts")
            const { createBillingRouter } = require("../../apps/gateway/routes/billing.ts")
            const { startBillingWorker } = require("../../apps/gateway/billing/worker.ts")
            let clock = Date.now()
            const advance = (ms) => {
                clock += ms
            }
            const provider = {
                payments: new Map(),
                keys: new Map(),
                creates: [],
                gets: [],
                createFault: null,
                getFault: null,
                async create(request, key) {
                    this.creates.push({ key, request: structuredClone(request) })
                    if (!this.keys.has(key)) {
                        const id = crypto.randomUUID()
                        this.keys.set(key, id)
                        this.payments.set(id, {
                            id,
                            status: "pending",
                            paid: false,
                            test: true,
                            amount: structuredClone(request.amount),
                            recipient: { account_id: "12345" },
                            metadata: structuredClone(request.metadata),
                            confirmation: {
                                type: "redirect",
                                confirmation_url: "https://yoomoney.ru/checkout/payments/v2/contract?orderId=" + id
                            }
                        })
                    }
                    if (this.createFault) return this.createFault()
                    return structuredClone(this.payments.get(this.keys.get(key)))
                },
                async get(id) {
                    this.gets.push(id)
                    if (this.getFault) return this.getFault(id)
                    return structuredClone(this.payments.get(id))
                },
                pay(order) {
                    Object.assign(this.payments.get(this.keys.get(order.orderId)), { status: "succeeded", paid: true })
                }
            }
            const newService = () =>
                new BillingService({
                    pool,
                    config: readBillingConfig,
                    provider: () => provider,
                    now: () => new Date(clock),
                    onGrant: (id) => {
                        notifications.push(id)
                    }
                })
            let service = newService()
            const input = (planSlug = "medium", username = "alex") => ({
                planSlug,
                userId: username === "mira" ? 2 : 1,
                username,
                email: `${username}@example.test`,
                requestId: crypto.randomUUID(),
                statusToken: crypto.randomBytes(32).toString("base64url")
            })
            const ip = () => crypto.randomBytes(32).toString("hex")
            const count = async (table) =>
                Number((await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count)
            const reset = async () => {
                await pool.query("TRUNCATE billing_entitlements,billing_orders; DELETE FROM user_subscriptions")
                provider.payments.clear()
                provider.keys.clear()
                provider.creates = []
                provider.gets = []
                provider.createFault = null
                provider.getFault = null
                notifications.length = 0
                clock = Date.now()
                service = newService()
            }
            const settled = async (data) => {
                const order = await service.create(data, ip())
                provider.pay(order)
                await service.tick()
                return service.status(order.orderId, data.statusToken)
            }

            await t.test(
                "concurrent create/retry binds account and price without storing capability or secret",
                async () => {
                    await reset()
                    const data = input()
                    const orders = await Promise.all(Array.from({ length: 8 }, () => service.create(data, ip())))
                    assert.equal(new Set(orders.map((order) => order.orderId)).size, 1)
                    assert.equal(provider.creates.length, 1)
                    assert.equal(await count("billing_orders"), 1)
                    assert.equal(await count("billing_entitlements"), 0)
                    assert.deepEqual(provider.creates[0].request.amount, { value: "100.00", currency: "RUB" })
                    assert.equal(provider.creates[0].request.metadata.user_id, "1")
                    const stored = JSON.stringify((await pool.query("SELECT * FROM billing_orders")).rows)
                    assert(!stored.includes(data.statusToken) && !stored.includes(process.env.YOOKASSA_SECRET_KEY))
                    await assert.rejects(
                        service.create({ ...data, planSlug: "pro" }, ip()),
                        (error) => error.code === "checkout_conflict"
                    )
                    await assert.rejects(
                        service.create({ ...data, statusToken: input().statusToken }, ip()),
                        (error) => error.code === "checkout_conflict"
                    )
                    await assert.rejects(
                        service.create({ ...input(), email: "wrong@example.test" }, ip()),
                        (error) => error.code === "account_not_found"
                    )
                }
            )
            await t.test(
                "only verified GET succeeded+paid grants once under concurrent status and worker requests",
                async () => {
                    await reset()
                    const data = input(),
                        order = await service.create(data, ip())
                    assert.equal(order.grant, null)
                    provider.pay(order)
                    const results = await Promise.all(
                        Array.from({ length: 15 }, () => service.status(order.orderId, data.statusToken))
                    )
                    assert.equal(await count("billing_entitlements"), 1)
                    const final = await service.status(order.orderId, data.statusToken)
                    assert.equal(final.status, "succeeded")
                    assert(final.grant.applied)
                    assert(provider.gets.length >= 1)
                    assert.equal(notifications.length, 1)
                    assert(results.every((value) => value.status === "pending" || value.status === "succeeded"))
                    await assert.rejects(
                        service.status(order.orderId, input().statusToken),
                        (error) => error.status === 404
                    )
                }
            )
            await t.test("worker issues a paid plan after browser closure and a service restart", async () => {
                await reset()
                const data = input(),
                    order = await service.create(data, ip())
                provider.pay(order)
                service = newService()
                const stop = startBillingWorker(service)
                try {
                    await until(async () => (await count("billing_entitlements")) === 1)
                } finally {
                    stop()
                }
                assert.equal((await service.status(order.orderId, data.statusToken)).status, "succeeded")
            })
            await t.test("lost create response retries the frozen provider request and idempotence key", async () => {
                await reset()
                provider.createFault = () => {
                    throw new Error("lost after provider commit")
                }
                const data = input(),
                    first = await service.create(data, ip())
                assert.equal(first.status, "creating")
                assert.equal(provider.payments.size, 1)
                provider.createFault = null
                advance(3001)
                service = newService()
                const recovered = await service.create(data, ip())
                assert.equal(recovered.orderId, first.orderId)
                assert.equal(provider.payments.size, 1)
                assert.equal(provider.creates.length, 2)
                assert.deepEqual(provider.creates[0], provider.creates[1])
                provider.pay(recovered)
                await service.tick()
                assert.equal(await count("billing_entitlements"), 1)
            })
            await t.test(
                "unknown create never retries beyond the conservative provider idempotence window",
                async () => {
                    await reset()
                    provider.createFault = () => {
                        throw new Error("unknown")
                    }
                    const data = input(),
                        order = await service.create(data, ip())
                    advance(23 * 60 * 60 * 1000 + 1)
                    await service.tick()
                    assert.equal((await service.status(order.orderId, data.statusToken)).status, "review")
                    assert.equal(provider.creates.length, 1)
                    assert.equal(await count("billing_entitlements"), 0)
                }
            )
            await t.test(
                "pending, waiting capture, canceled and provider failures never produce a false grant",
                async () => {
                    await reset()
                    const data = input(),
                        order = await service.create(data, ip()),
                        payment = provider.payments.get(provider.keys.get(order.orderId))
                    Object.assign(payment, { status: "waiting_for_capture", paid: true })
                    assert.equal((await service.status(order.orderId, data.statusToken)).status, "pending")
                    assert.equal(await count("billing_entitlements"), 0)
                    provider.getFault = () => {
                        throw new Error("transport")
                    }
                    advance(3001)
                    assert.equal((await service.status(order.orderId, data.statusToken)).status, "pending")
                    provider.getFault = null
                    Object.assign(payment, { status: "canceled", paid: false })
                    advance(30000)
                    assert.equal((await service.status(order.orderId, data.statusToken)).status, "canceled")
                    assert.equal(await count("billing_entitlements"), 0)
                }
            )
            await t.test("amount, currency, test, recipient, metadata and paid mismatches fail closed", async () => {
                for (const mutation of [
                    (payment) => {
                        payment.amount.value = "0.01"
                    },
                    (payment) => {
                        payment.amount.currency = "USD"
                    },
                    (payment) => {
                        payment.test = false
                    },
                    (payment) => {
                        payment.recipient.account_id = "other"
                    },
                    (payment) => {
                        payment.metadata.order_id = crypto.randomUUID()
                    },
                    (payment) => {
                        payment.metadata.user_id = "2"
                    },
                    (payment) => {
                        payment.metadata.plan_slug = "enterprise"
                    },
                    (payment) => {
                        payment.paid = false
                    }
                ]) {
                    await reset()
                    const data = input(),
                        order = await service.create(data, ip())
                    provider.pay(order)
                    mutation(provider.payments.get(provider.keys.get(order.orderId)))
                    const final = await service.status(order.orderId, data.statusToken)
                    assert.equal(final.status, "review")
                    assert.equal(final.grant, null)
                    assert.equal(final.confirmationUrl, null)
                    assert.equal(await count("billing_entitlements"), 0)
                }
            })
            await t.test("a non-test create response never exposes a checkout redirect", async () => {
                await reset()
                provider.createFault = () => ({ ...structuredClone([...provider.payments.values()][0]), test: false })
                const order = await service.create(input(), ip())
                assert.equal(order.status, "review")
                assert.equal(order.confirmationUrl, null)
                assert.equal(await count("billing_entitlements"), 0)
            })
            await t.test("the new-order IP quota is atomic across concurrent requests", async () => {
                await reset()
                const hash = ip()
                const results = await Promise.allSettled(
                    Array.from({ length: 25 }, () => service.create(input(), hash))
                )
                assert.equal(results.filter((result) => result.status === "fulfilled").length, 20)
                const rejected = results.filter((result) => result.status === "rejected")
                assert.equal(rejected.length, 5)
                assert(rejected.every((result) => result.reason.code === "rate_limited"))
                assert.equal(await count("billing_orders"), 20)
            })
            await t.test(
                "manual plans survive and two paid months extend serially without duplicate grants",
                async () => {
                    await reset()
                    await pool.query(
                        "INSERT INTO user_subscriptions(user_id,plan_slug,note) VALUES(1,'pro','manual-preserve')"
                    )
                    const a = input(),
                        b = input()
                    const orders = await Promise.all([service.create(a, ip()), service.create(b, ip())])
                    orders.forEach((order) => provider.pay(order))
                    await Promise.all([service.tick(), service.tick()])
                    const grants = (await pool.query("SELECT * FROM billing_entitlements ORDER BY valid_from")).rows
                    assert.equal(grants.length, 2)
                    assert.equal(grants[1].valid_from.toISOString(), grants[0].valid_until.toISOString())
                    assert.equal(
                        grants[1].valid_until.toISOString(),
                        addCalendarMonth(grants[0].valid_until).toISOString()
                    )
                    assert.deepEqual(
                        (await pool.query("SELECT plan_slug,note FROM user_subscriptions WHERE user_id=1")).rows[0],
                        { plan_slug: "pro", note: "manual-preserve" }
                    )
                    assert.equal(await getPlanSlugForUser(1), "pro")
                }
            )
            await t.test("paid expiry restores the manual baseline and test grants cannot become live", async () => {
                await reset()
                const result = await settled(input("enterprise"))
                assert.equal(await getPlanSlugForUser(1), "enterprise")
                assert.equal(await effectivePaidPlan(1, "medium", pool, null), "medium")
                assert.equal(
                    await effectivePaidPlan(1, "free", pool, { ...readBillingConfig(), shopId: "different" }),
                    "free"
                )
                assert.equal(
                    await effectivePaidPlan(
                        1,
                        "medium",
                        pool,
                        readBillingConfig(),
                        new Date(new Date(result.grant.validUntil).getTime() + 1)
                    ),
                    "medium"
                )
            })
            await t.test("room limits use the owner and include changes visible to the supplied transaction", async () => {
                await reset()
                await settled(input("enterprise"))
                const client = await pool.connect()
                try {
                    await client.query("BEGIN")
                    const { rows: [room] } = await client.query(
                        "INSERT INTO rooms(name,created_by) VALUES('billing-fixture',1) RETURNING id"
                    )
                    assert.equal(await getRoomPlanLimits(room.id, pool), null)
                    assert.equal((await getRoomPlanLimits(room.id, client)).planSlug, "enterprise")
                    await client.query("UPDATE rooms SET created_by=2 WHERE id=$1", [room.id])
                    assert.equal((await getRoomPlanLimits(room.id, client)).planSlug, "free")
                    await client.query("INSERT INTO user_subscriptions(user_id,plan_slug) VALUES(2,'pro')")
                    assert.equal((await getRoomPlanLimits(room.id, client)).planSlug, "pro")
                } finally {
                    await client.query("ROLLBACK")
                    client.release()
                }
            })
            await t.test("live payments grant once, survive restart and never inherit test entitlements", async () => {
                await reset()
                await settled(input("enterprise"))
                const liveConfig = {
                    ...readBillingConfig(),
                    mode: "live",
                    secretKey: "live_isolated-fake-provider-secret"
                }
                const liveProvider = {
                    async create(request, key) {
                        const payment = await provider.create(request, key)
                        payment.test = false
                        provider.payments.set(payment.id, structuredClone(payment))
                        return payment
                    },
                    get: (id) => provider.get(id)
                }
                const makeLive = () =>
                    new BillingService({
                        pool,
                        config: () => liveConfig,
                        provider: () => liveProvider,
                        now: () => new Date(clock)
                    })
                let liveService = makeLive()
                const data = input("medium")
                const liveOrder = await liveService.create(data, ip())
                assert.equal(liveOrder.mode, "live")
                assert.equal(liveOrder.status, "pending")
                assert.equal(await effectivePaidPlan(1, "free", pool, liveConfig), "free")
                provider.pay(liveOrder)
                liveService = makeLive()
                await Promise.all(Array.from({ length: 6 }, () => liveService.tick()))
                const paid = await liveService.status(liveOrder.orderId, data.statusToken)
                assert.equal(paid.status, "succeeded")
                assert.equal(paid.grant.planSlug, "medium")
                assert.equal(paid.grant.effectivePlanSlug, "medium")
                assert.equal(await effectivePaidPlan(1, "free", pool, liveConfig), "medium")
                assert.equal(await getPlanSlugForUser(1), "enterprise")
                assert.equal(await effectivePaidPlan(1, "free", pool, { ...liveConfig, shopId: "67890" }), "free")
                const rows = (
                    await pool.query(
                        "SELECT mode,COUNT(*)::int AS count FROM billing_entitlements GROUP BY mode ORDER BY mode"
                    )
                ).rows
                assert.deepEqual(rows, [
                    { mode: "live", count: 1 },
                    { mode: "test", count: 1 }
                ])
            })
            await t.test("a stale worker lease cannot roll back a newer successful verification", async () => {
                await reset()
                const data = input(),
                    order = await service.create(data, ip())
                const old = structuredClone(provider.payments.get(provider.keys.get(order.orderId)))
                let release,
                    entered = false
                provider.getFault = () => {
                    entered = true
                    return new Promise((resolve) => {
                        release = () => resolve(old)
                    })
                }
                const first = service.reconcile(order.orderId)
                await until(() => entered)
                provider.getFault = null
                provider.pay(order)
                advance(31001)
                await service.reconcile(order.orderId)
                release()
                await first
                assert.equal((await service.status(order.orderId, data.statusToken)).status, "succeeded")
                assert.equal(await count("billing_entitlements"), 1)
            })
            await t.test(
                "grant transaction failure remains retryable and never reports success before commit",
                async () => {
                    await reset()
                    const data = input(),
                        order = await service.create(data, ip())
                    await pool.query(
                        "CREATE FUNCTION qa_reject_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated grant failure'; END $$; CREATE TRIGGER qa_reject_grant BEFORE INSERT ON billing_entitlements FOR EACH ROW EXECUTE FUNCTION qa_reject_grant()"
                    )
                    provider.pay(order)
                    await service.tick()
                    assert.equal(await count("billing_entitlements"), 0)
                    assert.equal((await service.status(order.orderId, data.statusToken)).status, "pending")
                    await pool.query(
                        "DROP TRIGGER qa_reject_grant ON billing_entitlements; DROP FUNCTION qa_reject_grant()"
                    )
                    advance(30000)
                    await service.tick()
                    assert.equal((await service.status(order.orderId, data.statusToken)).status, "succeeded")
                    assert.equal(await count("billing_entitlements"), 1)
                    assert.equal(notifications.length, 1)
                }
            )
            await t.test(
                "deleted accounts and expired capability access cannot issue a plan to another user",
                async () => {
                    await reset()
                    const data = input("medium", "mira"),
                        order = await service.create(data, ip())
                    provider.pay(order)
                    await pool.query("DELETE FROM users WHERE id=2")
                    await service.tick()
                    assert.equal((await service.status(order.orderId, data.statusToken)).status, "review")
                    assert.equal(await count("billing_entitlements"), 0)
                    advance(8 * 24 * 60 * 60 * 1000)
                    assert.equal((await service.status(order.orderId, data.statusToken)).status, "expired")
                }
            )
            await t.test(
                "actual HTTP catalog/create/status does not disclose credentials or trust browser prices",
                async () => {
                    await reset()
                    const express = backendRequire("express"),
                        app = express()
                    const accountToken = crypto.randomUUID()
                    const { configureBearerAccess } = require("../../apps/shared/http/bearerAuth.ts")
                    configureBearerAccess(app, async (token) => token === accountToken
                        ? { kind: "allowed", session: { id: 1, username: "alex" } }
                        : { kind: "invalid" })
                    app.use("/playtime/billing", createBillingRouter(service))
                    server = require("node:http").createServer(app)
                    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
                    const base = `http://127.0.0.1:${server.address().port}/playtime/billing`
                    const catalogResponse = await fetch(base + "/catalog"),
                        catalog = await catalogResponse.json()
                    assert.equal(catalog.enabled, true)
                    assert.equal(catalog.mode, "test")
                    assert.equal(catalogResponse.headers.get("cache-control"), "no-store")
                    assert(!JSON.stringify(catalog).includes(process.env.YOOKASSA_SECRET_KEY))
                    const data = input()
                    const accountHeaders = { "content-type": "application/json", Authorization: "Bearer " + accountToken }
                    const anonymous = await fetch(base + "/orders", {
                        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data)
                    })
                    assert.equal(anonymous.status, 401)
                    const account = await fetch(base + "/account", { headers: accountHeaders })
                    assert.deepEqual(await account.json(), { username: "alex", email: "alex@example.test" })
                    const other = await fetch(base + "/orders", {
                        method: "POST", headers: accountHeaders, body: JSON.stringify(input("medium", "mira"))
                    })
                    assert.equal(other.status, 404)
                    const createdResponse = await fetch(base + "/orders", {
                        method: "POST",
                        headers: accountHeaders,
                        body: JSON.stringify({ ...data, amount: { value: "0.01", currency: "RUB" }, userId: 999 })
                    })
                    assert.equal(createdResponse.status, 200)
                    const order = await createdResponse.json()
                    assert.equal(order.plan.amount.value, "100.00")
                    assert(!JSON.stringify(order).includes(data.statusToken))
                    const unauthorized = await fetch(base + "/orders/" + order.orderId)
                    assert.equal(unauthorized.status, 404)
                    provider.pay(order)
                    await service.tick()
                    const status = await fetch(base + "/orders/" + order.orderId, {
                        headers: { Authorization: "Bearer " + data.statusToken }
                    })
                    const paid = await status.json()
                    assert.equal(paid.status, "succeeded")
                    assert(paid.grant.applied)
                    assert.equal(status.headers.get("cache-control"), "no-store")
                    const malformed = await fetch(base + "/orders", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: '{"statusToken":"' + data.statusToken
                    })
                    assert.equal(malformed.status, 400)
                    const parseError = await malformed.text()
                    assert(!parseError.includes(data.statusToken))
                    assert.equal(JSON.parse(parseError).code, "invalid_checkout")
                    await redis.set("billing:budget:create:global", "120", "EX", 60)
                    const limited = await fetch(base + "/orders", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(input())
                    })
                    assert.equal(limited.status, 429)
                    assert(Number(limited.headers.get("retry-after")) > 0)
                }
            )
        } finally {
            if (server) await new Promise((resolve) => server.close(resolve))
            await Promise.allSettled([pool?.end(), redis?.quit()])
            await Promise.allSettled(containers.map((id) => exec("docker", ["rm", "-f", id], { timeout: 30000 })))
            if (temporary) await fs.rm(temporary, { recursive: true, force: true })
        }
    }
)
