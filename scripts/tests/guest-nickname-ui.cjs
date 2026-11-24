const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const crypto = require("node:crypto")
const { promisify } = require("node:util")
const { execFile } = require("node:child_process")
const { createRequire } = require("node:module")
const exec = promisify(execFile)
const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const builtWeb = process.env.GUEST_NICKNAME_BUILT_WEB ? path.resolve(process.env.GUEST_NICKNAME_BUILT_WEB) : null
const output = path.resolve(process.env.GUEST_NICKNAME_OUTPUT || "artifacts/guest-nickname-ui")
const containers = [],
    screenshots = [],
    errors = [],
    external = [],
    events = []
const sessions = new Map()
const busyFaults = new Map()
let pool, redis, vite, io, browser, temporary
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function eventually(check, label, timeout = 25000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
        if (await check()) return
        await wait(75)
    }
    throw new Error("Timed out: " + label)
}
async function capture(page, label) {
    await page.locator('[class*="messagesSkelOverlay"][aria-hidden]').waitFor({ state: "detached", timeout: 15000 })
    const file = label + ".png"
    await page.screenshot({ path: path.join(output, file), fullPage: true })
    screenshots.push(file)
}
async function sourceHashes() {
    const files = [
        "scripts/fixtures/guest-nickname-peer.tsx",
        "scripts/fixtures/guest-nickname-built.cjs",
        "scripts/tests/guest-nickname-ui.cjs",
        "apps/auth-api/routes/auth.ts",
        "apps/auth-api/auth/guestLifecycle.ts",
        "apps/chat-api/socket/peerIdentity.ts"
    ]
    const walk = async (directory) => {
        for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
            const file = path.posix.join(directory, entry.name)
            if (entry.isDirectory()) await walk(file)
            else if (/\.(tsx?|css)$/.test(file) && !/\.test\./.test(file)) files.push(file)
        }
    }
    for (const directory of [
        "apps/frontend/src/components/Chat",
        "apps/frontend/src/features/chat",
        "apps/frontend/src/pages/Friends",
        "apps/frontend/src/pages/MainLayout",
        "apps/frontend/src/ui/layout",
        "apps/frontend/src/server/socket",
        "apps/frontend/src/server/socketContext",
        "apps/chat-api/socket/messages",
        "apps/auth-api/routes/auth"
    ])
        await walk(directory)
    return Object.fromEntries(
        await Promise.all(
            files.sort().map(async (file) => [
                file,
                crypto
                    .createHash("sha256")
                    .update(await fs.readFile(path.join(root, file)))
                    .digest("hex")
            ])
        )
    )
}
const bubble = (page, text) => page.locator("[data-msg-id]").filter({ hasText: text })
async function ack(page, event, payload = {}) {
    return page.evaluate(
        ({ event, payload }) =>
            new Promise((resolve, reject) => {
                window.guestNicknameQa.socket
                    .timeout(12000)
                    .emit(event, payload, (error, data) => (error ? reject(new Error(error.message)) : resolve(data)))
            }),
        { event, payload }
    )
}
async function http(base, route, body) {
    const response = await fetch(base + "/playtime/auth/" + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
    const value = await response.json()
    assert.equal(response.status, 200, route + ": " + JSON.stringify(value))
    return value
}
async function send(page, text) {
    const input = page.getByPlaceholder("Сообщение…", { exact: true })
    await input.fill(text)
    await input.press("Enter")
    await bubble(page, text)
        .getByLabel(/^(Отправлено|Прочитано)$/)
        .waitFor()
}
;(async () => {
    await fs.mkdir(output, { recursive: true })
    await Promise.all(["result.json", "failure.json"].map((file) => fs.rm(path.join(output, file), { force: true })))
    const initialHashes = await sourceHashes()
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-guest-nickname-"))
    const docker = async (...args) => (await exec("docker", args, { timeout: 60000 })).stdout.trim()
    assert.match(await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}"), /^unix:\/\//)
    const suffix = crypto.randomBytes(6).toString("hex"),
        password = crypto.randomBytes(24).toString("hex")
    containers.push(
        await docker(
            "run",
            "--rm",
            "-d",
            "--name",
            `playtime-guest-pg-${suffix}`,
            "--label",
            "playtime.qa=guest-nickname",
            "-p",
            "127.0.0.1::5432",
            "-e",
            "POSTGRES_USER=playtime_test",
            "-e",
            "POSTGRES_DB=playtime_test",
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
            `playtime-guest-redis-${suffix}`,
            "--label",
            "playtime.qa=guest-nickname",
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
        PG_DATABASE: "playtime_test",
        PG_PASSWORD: password,
        REDIS_URL: `redis://:${password}@127.0.0.1:${redisPort}/0`,
        JWT_SECRET_ENV: "isolated-guest-nickname-secret-not-production",
        WEBRTC_STUN_URLS: "stun:127.0.0.1:9"
    })
    for (const key of [
        "RUSTORE_PUSH_PROJECT_ID",
        "RUSTORE_PUSH_SERVICE_TOKEN",
        "WEBRTC_TURN_HOST",
        "WEBRTC_TURN_URL",
        "WEBRTC_TURN_SECRET"
    ])
        delete process.env[key]
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
    }, "isolated database readiness")
    await pool.query(await fs.readFile(path.join(root, "apps/database/schema.sql"), "utf8"))
    for (const name of (await fs.readdir(path.join(root, "apps/database/migrations")))
        .filter((name) => name.endsWith(".sql"))
        .sort())
        await pool.query(await fs.readFile(path.join(root, "apps/database/migrations", name), "utf8"))
    const bcrypt = backendRequire("bcrypt")
    const passwordHash = await bcrypt.hash("QaAliceSecure123!", 10)
    const alice = (
        await pool.query(
            "INSERT INTO users(username,email,password_hash,email_verified_at) VALUES('Alice','alice@example.test',$1,NOW()) RETURNING id",
            [passwordHash]
        )
    ).rows[0]
    const { signUserAccessToken, issueRefreshToken } = require("../../apps/auth-api/auth/index.ts")
    const aliceSession = { id: alice.id, username: "Alice", sessionVersion: 0 }
    const aliceRefresh = await issueRefreshToken(aliceSession)
    sessions.set(alice.id, {
        token: signUserAccessToken(aliceSession),
        refreshToken: aliceRefresh,
        user: { id: alice.id, username: "Alice" }
    })
    const express = backendRequire("express")
    const auth = express()
    const { configureBearerAccess } = require("../../apps/shared/http/bearerAuth.ts")
    const { verifyBearerAccess } = require("../../apps/auth-api/http/bearerAuthMiddleware.ts")
    configureBearerAccess(auth, verifyBearerAccess)
    auth.use(express.json())
    auth.use("/playtime/auth", require("../../apps/auth-api/routes/auth.ts").default)
    auth.use("/playtime/subscription", require("../../apps/gateway/routes/subscription.ts").default)
    auth.use("/playtime/peers", require("../../apps/chat-api/routes/peerSafety.ts").default)
    if (builtWeb) auth.use("/playtime/app", express.static(builtWeb))
    const { createServer } = await import("vite")
    const { default: react } = await import("@vitejs/plugin-react")
    vite = await createServer({
        root,
        publicDir: path.join(root, "apps/frontend/public"),
        optimizeDeps: { entries: ["scripts/fixtures/guest-nickname-peer.tsx"] },
        cacheDir: path.join(temporary, "vite-cache"),
        configFile: false,
        define: {
            "process.env.REACT_APP_WEB_BUILD": '"true"',
            "process.env.REACT_APP_API_BASE": '"/playtime"',
            "process.env.REACT_APP_SOCKET_URL": '""'
        },
        server: {
            port: Number(process.env.GUEST_NICKNAME_PORT || 4196),
            host: "127.0.0.1",
            strictPort: true,
            hmr: false,
            watch: null
        },
        plugins: [
            react(),
            {
                name: "guest-nickname-fixture",
                configureServer(server) {
                    server.middlewares.use(auth)
                    server.middlewares.use("/__qa-session", (request, response) => {
                        const id = Number(new URL(request.url, "http://localhost").searchParams.get("user"))
                        const session = sessions.get(id)
                        response.setHeader("Content-Type", "application/json")
                        response.statusCode = session ? 200 : 404
                        response.end(
                            JSON.stringify(
                                session
                                    ? { token: session.token, user: session.user }
                                    : { error: "unknown disposable session" }
                            )
                        )
                    })
                    server.middlewares.use("/__guest-nickname", async (_request, response) => {
                        response.setHeader("Content-Type", "text/html")
                        response.end(
                            await server.transformIndexHtml(
                                "/__guest-nickname",
                                '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/fixtures/guest-nickname-peer.tsx"></script></body></html>'
                            )
                        )
                    })
                }
            }
        ]
    })
    const { Server } = backendRequire("socket.io")
    const { authSocket } = require("../../apps/gateway/legacy/socketAuth.ts")
    const { attachSocketConnection } = require("../../apps/gateway/legacy/socket.ts")
    const { accessSessionRoom, deviceSessionRoom } = require("../../apps/auth-api/auth/sessionVersion.ts")
    const { peerIdentityUserRoom } = require("../../apps/chat-api/socket/peerIdentity.ts")
    io = new Server(vite.httpServer, { path: builtWeb ? "/playtime/socket.io" : "/qa-guest-socket" })
    auth.set("io", io)
    require("../../apps/auth-api/auth/guestLifecycle.ts").setGuestArchiveListener(async (userId) => {
        const peers = (
            await pool.query(
                "SELECT CASE WHEN user_id=$1 THEN friend_id ELSE user_id END AS id FROM friendships WHERE user_id=$1 OR friend_id=$1",
                [userId]
            )
        ).rows
        for (const peer of peers) io.to(String(peer.id)).emit("friend:list:updated")
        io.in(String(userId)).disconnectSockets(true)
    })
    io.use(authSocket)
    io.on("connection", (socket) => {
        const user = socket.user
        socket.use((packet, next) => {
            const callback = packet[packet.length - 1]
            const faultKey = `${user.id}:${packet[0]}`
            if (typeof callback === "function" && busyFaults.get(faultKey)) {
                busyFaults.delete(faultKey)
                events.push({ userId: user.id, event: "forced-busy-ack", requestEvent: packet[0] })
                callback({ err: "Сервер обрабатывает ваши запросы. Повторите попытку." })
                return
            }
            if (typeof callback === "function")
                packet[packet.length - 1] = (response) => {
                    if (Array.isArray(response) && ["friend:list", "room:list"].includes(packet[0]))
                        events.push({
                            userId: user.id,
                            event: "ack-array",
                            requestEvent: packet[0],
                            length: response.length
                        })
                    if (response?.err)
                        events.push({ userId: user.id, event: "ack-error", requestEvent: packet[0], response })
                    callback(response)
                }
            next()
        })
        socket.join(String(user.id))
        socket.join(accessSessionRoom(socket.data.accessSession.jti))
        if (socket.data.accessSession.sessionId) socket.join(deviceSessionRoom(socket.data.accessSession.sessionId))
        if (socket.handshake.auth.peerIdentityProtocol === 1) socket.join(peerIdentityUserRoom(user.id))
        socket.onAny((event, payload) => events.push({ userId: user.id, event, peerUserId: payload?.peerUserId }))
        socket.on("get:username", (callback) => callback({ username: user.username, userId: user.id }))
        attachSocketConnection(io, socket, user)
    })
    await vite.listen()
    const base = `http://127.0.0.1:${vite.config.server.port}`
    const old = await http(base, "guest", { username: "Moon", requestKey: crypto.randomBytes(32).toString("hex") })
    sessions.set(old.user.id, old)
    await pool.query("INSERT INTO friendships(user_id,friend_id,status) VALUES($1,$2,'accepted')", [
        alice.id,
        old.user.id
    ])
    browser = await chromium.launch({
        headless: true,
        ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {})
    })
    if (builtWeb) {
        await require("../fixtures/guest-nickname-built.cjs")({
            pool,
            redis,
            io,
            browser,
            base,
            sessions,
            alice,
            old,
            http,
            eventually,
            capture,
            output,
            events,
            errors,
            external,
            initialHashes,
            sourceHashes,
            builtWeb,
            forceBusy:
                process.env.GUEST_NICKNAME_FORCE_BUSY === "1"
                    ? (userId) => {
                          for (const event of ["friend:list", "room:list"]) busyFaults.set(`${userId}:${event}`, true)
                          io.to(String(userId)).emit("friend:list:updated")
                      }
                    : null
        })
        return
    }
    const open = async (id, peer) => {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
            serviceWorkers: "block"
        })
        const page = await context.newPage()
        page.on("pageerror", (error) => errors.push(error.message))
        await page.route("**/*", (route) => {
            const url = new URL(route.request().url())
            if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) return route.continue()
            if (url.hostname !== "cdn.jsdelivr.net") external.push(url.origin)
            return route.abort()
        })
        await page.goto(`${base}/__guest-nickname?user=${id}&peer=${peer}`)
        await page
            .getByTestId("session-ready")
            .filter({ hasText: /^ready$/ })
            .waitFor()
        return page
    }
    const alicePage = await open(alice.id, old.user.id)
    const oldPage = await open(old.user.id, alice.id)
    await send(alicePage, "old Moon private history")
    await bubble(oldPage, "old Moon private history").waitFor()
    await bubble(alicePage, "old Moon private history").getByLabel("Прочитано", { exact: true }).waitFor()
    const original = (await pool.query("SELECT id,sender_id,receiver_id,content FROM messages ORDER BY id")).rows
    assert.equal(original.length, 1)
    assert.match(original[0].content, /^E2E1:/)
    assert.equal(original[0].receiver_id, old.user.id)
    await capture(alicePage, "01-before-logout-desktop")
    await http(base, "revoke", { token: old.token, refreshToken: old.refreshToken })
    await eventually(
        async () =>
            !!(await pool.query("SELECT guest_archived_at FROM users WHERE id=$1", [old.user.id])).rows[0]
                .guest_archived_at,
        "guest archived after real logout"
    )
    assert.deepEqual(
        (await pool.query("SELECT id,sender_id,receiver_id,content FROM messages ORDER BY id")).rows,
        original
    )
    for (const key of await redis.keys("guest_register_lock:*")) await redis.del(key)
    const fresh = await http(base, "guest", { username: "Moon", requestKey: crypto.randomBytes(32).toString("hex") })
    sessions.set(fresh.user.id, fresh)
    assert.notEqual(fresh.user.id, old.user.id)
    await alicePage.getByRole("button", { name: "Обновить контакты QA", exact: true }).click()
    await alicePage.getByRole("status").filter({ hasText: "Гостевой аккаунт завершён" }).waitFor()
    await bubble(alicePage, "old Moon private history").waitFor()
    assert.equal(await alicePage.locator("textarea").count(), 0, "Archived history has no composer")
    assert.equal(
        await alicePage.getByRole("button", { name: "Позвонить", exact: true }).count(),
        0,
        "Archived history has no call action"
    )
    await capture(alicePage, "02-archived-history-desktop")
    await alicePage.setViewportSize({ width: 390, height: 844 })
    await capture(alicePage, "03-archived-history-390")
    await alicePage.setViewportSize({ width: 1440, height: 1000 })
    const freshPage = await open(fresh.user.id, alice.id)
    await alicePage.getByRole("button", { name: "Контакты QA", exact: true }).click()
    const input = alicePage.getByPlaceholder("Введите никнейм")
    await input.fill("Moon")
    await input.press("Enter")
    await freshPage.getByRole("button", { name: "Контакты QA", exact: true }).click()
    await freshPage.getByRole("button", { name: "Принять заявку", exact: true }).click()
    await eventually(
        async () =>
            (await ack(alicePage, "friend:list")).some(
                (row) => row.other_user_id === fresh.user.id && row.status === "accepted"
            ),
        "new Moon accepted by its actual ID"
    )
    const rows = alicePage.locator("li").filter({ hasText: "Moon" })
    await eventually(async () => (await rows.count()) === 2, "separate archived and new Moon contacts")
    await capture(alicePage, "04-two-distinct-contacts-desktop")
    await rows
        .filter({ hasNotText: /Гостевой аккаунт завершён|Гость вышел/ })
        .getByRole("button", { name: "Написать", exact: true })
        .click()
    await alicePage
        .getByTestId("selected-peer-id")
        .filter({ hasText: new RegExp(`^${fresh.user.id}$`) })
        .waitFor()
    await alicePage.getByPlaceholder("Сообщение…", { exact: true }).waitFor()
    assert.equal(await bubble(alicePage, "old Moon private history").count(), 0)
    await freshPage
        .locator("li")
        .filter({ hasText: "Alice" })
        .getByRole("button", { name: "Написать", exact: true })
        .click()
    await send(alicePage, "new Moon separate encrypted history")
    await bubble(freshPage, "new Moon separate encrypted history").waitFor()
    await bubble(alicePage, "new Moon separate encrypted history").getByLabel("Прочитано", { exact: true }).waitFor()
    await capture(alicePage, "05-new-identity-chat-desktop")
    await alicePage.setViewportSize({ width: 390, height: 844 })
    await capture(alicePage, "06-new-identity-chat-390")
    await alicePage.setViewportSize({ width: 1440, height: 1000 })
    await alicePage.getByRole("button", { name: "Контакты QA", exact: true }).click()
    await alicePage
        .locator("li")
        .filter({ hasText: "Moon" })
        .filter({ hasText: /Гостевой аккаунт завершён|Гость вышел/ })
        .getByRole("button", { name: "Написать", exact: true })
        .click()
    await alicePage
        .getByTestId("selected-peer-id")
        .filter({ hasText: new RegExp(`^${old.user.id}$`) })
        .waitFor()
    await bubble(alicePage, "old Moon private history").waitFor()
    await send(freshPage, "incoming new holder never joins old chat")
    await eventually(
        async () =>
            (await pool.query("SELECT COUNT(*)::int n FROM messages WHERE sender_id=$1", [fresh.user.id])).rows[0].n ===
            1,
        "incoming new holder committed"
    )
    const incomingId = (
        await pool.query("SELECT id FROM messages WHERE sender_id=$1 ORDER BY id DESC LIMIT 1", [fresh.user.id])
    ).rows[0].id
    await eventually(
        () => alicePage.evaluate((id) => window.guestNicknameQa.received.includes(id), incomingId),
        "Alice actually receives the new holder event while viewing archived chat"
    )
    assert.equal(await bubble(alicePage, "incoming new holder never joins old chat").count(), 0)
    assert.equal(await bubble(alicePage, "new Moon separate encrypted history").count(), 0)
    for (const payload of [
        { username: "Moon", peerUserId: old.user.id },
        { username: "Moon", peerUserId: "invalid" },
        { username: "Moon" }
    ]) {
        const call = await ack(alicePage, "call:start", payload)
        assert.ok(call.err && !call.success, "Archived/malformed/name-only call must fail closed")
        const sent = await ack(alicePage, "message:send", {
            ...payload,
            message: original[0].content,
            clientMessageId: crypto.randomUUID()
        })
        assert.ok(sent.err && !sent.success, "Archived/malformed/name-only send must fail closed")
    }
    const authoritativeProfile = await ack(alicePage, "profile:get", {
        username: "stale-display-name",
        peerUserId: fresh.user.id
    })
    assert.equal(authoritativeProfile.profile.userId, fresh.user.id, "Explicit peer ID overrides stale display name")
    const persisted = (await pool.query("SELECT id,sender_id,receiver_id,content FROM messages ORDER BY id")).rows
    assert.deepEqual(persisted[0], original[0])
    assert.equal(persisted.length, 3)
    assert(
        persisted
            .slice(1)
            .every(
                (row) =>
                    [row.sender_id, row.receiver_id].includes(fresh.user.id) &&
                    ![row.sender_id, row.receiver_id].includes(old.user.id)
            )
    )
    assert.equal(external.length, 0, "No external providers contacted")
    assert.deepEqual(errors, [], "Browser has no runtime exceptions")
    const finalHashes = await sourceHashes()
    assert.deepEqual(finalHashes, initialHashes, "Tested sources stayed unchanged throughout execution")
    await fs.writeFile(
        path.join(output, "result.json"),
        JSON.stringify(
            {
                passed: true,
                aliceId: alice.id,
                oldGuestId: old.user.id,
                newGuestId: fresh.user.id,
                oldMessageId: original[0].id,
                persistedMessages: persisted.map(({ id, sender_id, receiver_id }) => ({ id, sender_id, receiver_id })),
                screenshots,
                events,
                sourceHashes: finalHashes
            },
            null,
            4
        ) + "\n"
    )
    console.log(JSON.stringify({ passed: true, screenshots, output }))
})()
    .catch(async (error) => {
        for (const [index, page] of (browser?.contexts().flatMap((context) => context.pages()) || []).entries())
            await capture(page, "failure-" + index).catch(() => {})
        await fs
            .writeFile(
                path.join(output, "failure.json"),
                JSON.stringify({ error: error.stack, errors, events, external }, null, 4)
            )
            .catch(() => {})
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await browser?.close().catch(() => {})
        await new Promise((resolve) => (io ? io.close(resolve) : resolve()))
        await vite?.close().catch(() => {})
        await pool?.end().catch(() => {})
        await redis?.quit().catch(() => {})
        for (const id of containers.reverse())
            await exec("docker", ["rm", "-f", id], { timeout: 30000 }).catch(() => {})
        if (temporary) await fs.rm(temporary, { recursive: true, force: true })
        process.exit(process.exitCode || 0)
    })
