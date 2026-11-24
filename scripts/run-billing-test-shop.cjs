const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const crypto = require("node:crypto")
const { constants } = require("node:fs")
const { promisify } = require("node:util")
const { execFile } = require("node:child_process")
const { createRequire } = require("node:module")
const exec = promisify(execFile)
const root = path.resolve(__dirname, "..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const work = "/tmp/playtime-yookassa-genuine"
const stateFile = path.join(work, "state.json")
const output = path.join(root, "artifacts/billing-genuine-test")
const staticRoot = path.join(root, "artifacts/billing-checkout-build/site")
const manifestFile = path.join(root, "artifacts/billing-checkout-build/manifest.json")
const traces = []
let state
let pool
let redis
let server
let stopWorker
let reportTimer
let closing = false
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const docker = async (...args) => (await exec("docker", args, { timeout: 60000 })).stdout.trim()
async function until(check) {
    for (let i = 0; i < 100; i++) {
        if (await check()) return
        await wait(100)
    }
    throw new Error("Isolated databases did not become ready")
}
async function credentials() {
    const directory = path.join(os.homedir(), ".codex/skills/playtime-yookassa/credentials")
    const parent = await fs.lstat(directory)
    assert(parent.isDirectory() && (parent.mode & 0o777) === 0o700 && parent.uid === process.getuid())
    const file = await fs.open(path.join(directory, "test.env"), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
        const info = await file.stat()
        assert(info.isFile() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid() && info.size < 16384)
        const values = {}
        for (const line of (await file.readFile("utf8"))
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter((value) => value && !value.startsWith("#"))) {
            const position = line.indexOf("=")
            const key = line.slice(0, position)
            assert(
                ["YOOKASSA_MODE", "YOOKASSA_SHOP_ID", "YOOKASSA_SECRET_KEY"].includes(key) &&
                    !Object.hasOwn(values, key)
            )
            values[key] = line.slice(position + 1).replace(/^(['"])(.*)\1$/, "$2")
        }
        assert(
            values.YOOKASSA_MODE === "test" &&
                /^\d+$/.test(values.YOOKASSA_SHOP_ID) &&
                values.YOOKASSA_SECRET_KEY?.startsWith("test_")
        )
        return values
    } finally {
        await file.close()
    }
}
function summary(value, expected, operation) {
    const object = value && typeof value === "object" ? value : {}
    return {
        operation,
        status: object.status,
        paid: object.paid === true,
        test: object.test === true,
        amount: object.amount?.value,
        currency: object.amount?.currency,
        shopMatches: object.recipient?.account_id === process.env.YOOKASSA_SHOP_ID,
        orderMatches: expected ? object.metadata?.order_id === expected.id : null,
        userMatches: expected ? object.metadata?.user_id === expected.userId : null,
        planMatches: expected ? object.metadata?.plan_slug === expected.planSlug : null
    }
}
async function report() {
    const rows = (
        await pool.query(`SELECT o.id,o.provider_id,o.state,o.plan_slug,o.amount_minor,o.mode,e.valid_from,e.valid_until
        FROM billing_orders o LEFT JOIN billing_entitlements e ON e.order_id=o.id ORDER BY o.created_at`)
    ).rows
    const manual =
        (await pool.query("SELECT plan_slug FROM user_subscriptions WHERE user_id=1")).rows[0]?.plan_slug ?? "free"
    const { getPlanSlugForUser } = require("../apps/gateway/subscription/subscriptionService.ts")
    const value = {
        scope: "Isolated genuine YooKassa TEST shop; manually submitted checkout; no production users or database",
        checkedAtUtc: new Date().toISOString(),
        shopId: process.env.YOOKASSA_SHOP_ID,
        testOnly: true,
        staticManifestSha256: state.staticManifestSha256,
        source: "exact built checkout UI",
        orders: rows.map((row) => ({
            orderId: row.id,
            paymentId: row.provider_id,
            state: row.state,
            planSlug: row.plan_slug,
            amount: (row.amount_minor / 100).toFixed(2),
            mode: row.mode,
            grantApplied: !!row.valid_until,
            validFrom: row.valid_from?.toISOString() ?? null,
            validUntil: row.valid_until?.toISOString() ?? null
        })),
        grantCount: rows.filter((row) => row.valid_until).length,
        effectivePlan: await getPlanSlugForUser(1),
        manualPlan: manual,
        providerChecks: traces,
        credentialsInEvidence: false
    }
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(value, null, 4) + "\n")
    return value
}
async function close() {
    if (closing) return
    closing = true
    stopWorker?.()
    clearInterval(reportTimer)
    await report().catch(() => {})
    const pending = pool
        ? Number(
              (
                  await pool.query(
                      "SELECT COUNT(*)::int AS count FROM billing_orders WHERE state IN ('creating','pending','review')"
                  )
              ).rows[0].count
          )
        : 1
    if (server) await new Promise((resolve) => server.close(resolve))
    await Promise.allSettled([pool?.end(), redis?.quit()])
    if (!pending && state) {
        for (const id of state.containers) await exec("docker", ["rm", "-f", id], { timeout: 30000 }).catch(() => {})
        await fs.rm(stateFile, { force: true })
    }
    console.log(
        JSON.stringify({ stopped: true, durablePendingStatePreserved: pending > 0, merchantCredentialsUntouched: true })
    )
    process.exit(0)
}
;(async () => {
    await fs.mkdir(work, { recursive: true, mode: 0o700 })
    await fs.chmod(work, 0o700)
    await fs.mkdir(output, { recursive: true })
    const merchant = await credentials()
    const manifestBytes = await fs.readFile(manifestFile)
    const manifest = JSON.parse(manifestBytes)
    for (const entry of manifest.files)
        assert.equal(
            crypto
                .createHash("sha256")
                .update(await fs.readFile(path.join(staticRoot, entry.path)))
                .digest("hex"),
            entry.sha256
        )
    assert.match(await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}"), /^unix:\/\//)
    try {
        state = JSON.parse(await fs.readFile(stateFile, "utf8"))
    } catch (error) {
        if (error.code !== "ENOENT") throw error
    }
    if (!state) {
        const password = crypto.randomBytes(24).toString("hex")
        const suffix = crypto.randomBytes(6).toString("hex")
        state = {
            password,
            containers: [],
            sitePort: 4198,
            username: "BillingQA",
            email: "billing-qa@example.invalid",
            staticManifestSha256: crypto.createHash("sha256").update(manifestBytes).digest("hex")
        }
        const save = () => fs.writeFile(stateFile, JSON.stringify(state), { mode: 0o600 })
        await save()
        state.containers.push(
            await docker(
                "run",
                "--rm",
                "-d",
                "--name",
                `playtime-genuine-pg-${suffix}`,
                "--label",
                "playtime.qa=billing-genuine",
                "-p",
                "127.0.0.1::5432",
                "-e",
                "POSTGRES_USER=playtime_test",
                "-e",
                "POSTGRES_DB=playtime_yookassa_genuine_test",
                "-e",
                `POSTGRES_PASSWORD=${password}`,
                "postgres:15-alpine"
            )
        )
        await save()
        state.containers.push(
            await docker(
                "run",
                "--rm",
                "-d",
                "--name",
                `playtime-genuine-redis-${suffix}`,
                "--label",
                "playtime.qa=billing-genuine",
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
        await save()
        const port = async (id, target) =>
            Number(
                await docker(
                    "inspect",
                    "--format",
                    `{{(index (index .NetworkSettings.Ports "${target}/tcp") 0).HostPort}}`,
                    id
                )
            )
        state.pgPort = await port(state.containers[0], 5432)
        state.redisPort = await port(state.containers[1], 6379)
        await save()
    }
    assert.equal(
        state.staticManifestSha256,
        crypto.createHash("sha256").update(manifestBytes).digest("hex"),
        "The genuine fixture must resume its exact UI artifact"
    )
    for (const id of state.containers)
        assert.equal(
            await docker("inspect", "--format", '{{index .Config.Labels "playtime.qa"}}', id),
            "billing-genuine"
        )
    await fs.writeFile(path.join(work, "empty.env"), "", { mode: 0o600 })
    Object.assign(process.env, merchant, {
        NODE_ENV: "test",
        DOTENV_CONFIG_PATH: path.join(work, "empty.env"),
        SITE_ORIGIN: `http://127.0.0.1:${state.sitePort}`,
        PG_HOST: "127.0.0.1",
        PG_PORT: String(state.pgPort),
        PG_USER: "playtime_test",
        PG_DATABASE: "playtime_yookassa_genuine_test",
        PG_PASSWORD: state.password,
        REDIS_URL: `redis://:${state.password}@127.0.0.1:${state.redisPort}/0`,
        JWT_SECRET_ENV: "isolated-genuine-checkout-session-secret-not-production"
    })
    require("tsx/cjs")
    ;({ pool, redis } = require("../apps/shared/config.ts"))
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
        "INSERT INTO users(id,username,email,password_hash,email_verified_at) VALUES(1,$1,$2,'isolated-no-login',NOW()) ON CONFLICT(id) DO NOTHING",
        [state.username, state.email]
    )
    const { BillingService } = require("../apps/gateway/billing/orderService.ts")
    const { readBillingConfig } = require("../apps/gateway/billing/config.ts")
    const { YooKassaProvider } = require("../apps/gateway/billing/yookassa.ts")
    const { CheckoutError } = require("../apps/gateway/billing/types.ts")
    const { startBillingWorker } = require("../apps/gateway/billing/worker.ts")
    assert(readBillingConfig(), "Protected test profile must be enabled")
    const provider = new YooKassaProvider(readBillingConfig())
    const service = new BillingService({
        pool,
        config: readBillingConfig,
        provider: () => ({
            async create(request, key) {
                const value = await provider.create(request, key)
                traces.push(
                    summary(
                        value,
                        { id: key, userId: request.metadata.user_id, planSlug: request.metadata.plan_slug },
                        "authenticated-create"
                    )
                )
                return value
            },
            async get(id) {
                const order = (
                    await pool.query("SELECT id,user_id,plan_slug FROM billing_orders WHERE provider_id=$1", [id])
                ).rows[0]
                const value = await provider.get(id)
                traces.push(
                    summary(
                        value,
                        order ? { id: order.id, userId: String(order.user_id), planSlug: order.plan_slug } : null,
                        "authenticated-get"
                    )
                )
                return value
            }
        })
    })
    const originalCreate = service.create.bind(service)
    service.create = async (input, hash) => {
        const existing = (await pool.query("SELECT request_id FROM billing_orders LIMIT 1")).rows[0]
        if (existing && existing.request_id !== input.requestId)
            throw new CheckoutError(409, "checkout_conflict", "Этот изолированный тест допускает только один заказ.")
        return originalCreate(input, hash)
    }
    const express = backendRequire("express")
    const app = express()
    app.use("/playtime/billing", require("../apps/gateway/routes/billing.ts").createBillingRouter(service))
    app.get("/__qa/status", async (_req, res) => {
        res.setHeader("Cache-Control", "no-store")
        res.json(await report())
    })
    app.get("/playtime/subscription/plans", (_req, res) =>
        res.json({ plans: require("../apps/shared/subscription/planCatalog.ts").listPlansPublic() })
    )
    app.post("/playtime/site-analytics/visit", (_req, res) => res.sendStatus(204))
    app.get("/playtime/releases/latest", (_req, res) => res.status(404).json({ error: "Isolated fixture" }))
    app.use("/playtime", express.static(staticRoot))
    app.get(/^\/playtime\/(?:checkout|admin|feedback|legal)(?:\/.*)?$/, (_req, res) =>
        res.sendFile(path.join(staticRoot, "index.html"))
    )
    server = await new Promise((resolve, reject) => {
        const instance = app.listen(state.sitePort, "127.0.0.1", () => resolve(instance))
        instance.once("error", reject)
    })
    stopWorker = startBillingWorker(service)
    reportTimer = setInterval(() => {
        void report().catch(() => {})
    }, 2000)
    await report()
    process.once("SIGINT", () => {
        void close()
    })
    process.once("SIGTERM", () => {
        void close()
    })
    console.log(
        JSON.stringify({
            ready: true,
            url: `http://127.0.0.1:${state.sitePort}/playtime/checkout?plan=medium`,
            username: state.username,
            email: state.email,
            pid: process.pid,
            providerPaymentsAtStartup: Number(
                (await pool.query("SELECT COUNT(*)::int AS count FROM billing_orders")).rows[0].count
            ),
            testOnly: true,
            exactBuiltManifest: state.staticManifestSha256
        })
    )
})().catch(() => {
    console.error(
        "Isolated genuine test harness could not start; no credential output. Preserve state for reconciliation."
    )
    process.exitCode = 1
})
