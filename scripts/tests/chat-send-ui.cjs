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
const output = path.resolve(process.env.CHAT_SEND_OUTPUT || "artifacts/chat-send-ui")
const containers = [],
    events = [],
    screenshots = [],
    errors = [],
    external = [],
    requests = []
let blockedEmojiAssets = 0
const nextModes = [],
    attempts = new Map(),
    held = []
let releaseHeldSends = false
let holdPeerKeys = false
const heldPeerKeys = []
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
const bubble = (page, text) => page.locator("[data-msg-id]").filter({ hasText: text })
async function capture(page, stage) {
    const file = stage + ".png"
    await page.screenshot({ path: path.join(output, file), fullPage: true })
    screenshots.push(file)
}
async function readSourceHashes() {
    const files = [
        "apps/chat-api/socket/messages/send.ts",
        "apps/chat-api/socket/messages/sendDm.ts",
        "apps/chat-api/socket/messages/sendMedia.ts",
        "apps/chat-api/socket/messages/sendRoom.ts",
        "apps/chat-api/socket/messages/sendTypes.ts",
        "scripts/fixtures/chat-send-peer.tsx",
        "scripts/tests/chat-send-ui.cjs"
    ]
    const walk = async (directory) => {
        for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
            const file = path.posix.join(directory, entry.name)
            if (entry.isDirectory()) await walk(file)
            else if (/\.(?:tsx?|css)$/.test(file) && !/\.test\./.test(file)) files.push(file)
        }
    }
    await walk("apps/frontend/src/components/Chat")
    await walk("apps/frontend/src/features/chat")
    const hashes = {}
    for (const file of files.sort())
        hashes[file] = crypto
            .createHash("sha256")
            .update(await fs.readFile(path.join(root, file)))
            .digest("hex")
    return hashes
}
async function snapshot(page) {
    return page.evaluate(() => ({
        draft: document.querySelector("textarea")?.value,
        focused: document.activeElement === document.querySelector("textarea"),
        disabled: document.querySelector("textarea")?.disabled,
        focusLosses: window.chatSendQa.focusLosses,
        rows: [...document.querySelectorAll("[data-msg-id]")].map((row) => ({
            id: row.getAttribute("data-msg-id"),
            text: row.textContent,
            labels: [...row.querySelectorAll("[aria-label]")].map((element) => element.getAttribute("aria-label"))
        }))
    }))
}
async function assertComposer(page, expected) {
    const state = await snapshot(page)
    assert.equal(state.disabled, false, "Text composer stays enabled")
    assert.equal(state.focused, true, "Text composer keeps focus")
    assert.equal(state.draft, expected, "The next draft is never cleared by an older send")
    assert.equal(await page.getByText(/Отправля(?:ется|ем) сообщение…/).count(), 0, "No blocking send banner")
    return state
}
function faultSocket(socket, userId) {
    let suppressSuccess = false
    return new Proxy(socket, {
        get(target, property) {
            if (property === "on")
                return (event, handler) => {
                    if (event === "profile:getDmPublicKey")
                        return target.on(event, (payload, ack) => {
                            if (holdPeerKeys && userId === 1 && payload.username === "mira") {
                                heldPeerKeys.push(() => handler(payload, ack))
                                return
                            }
                            handler(payload, ack)
                        })
                    if (event !== "message:send") return target.on(event, handler)
                    return target.on(event, async (payload, ack) => {
                        const clientId = payload.clientMessageId
                        const previous = attempts.get(clientId)
                        const item = previous || { mode: nextModes.shift() || "normal", count: 0 }
                        attempts.set(clientId, item)
                        item.count++
                        requests.push({
                            userId,
                            clientId,
                            mode: item.mode,
                            attempt: item.count,
                            encrypted: String(payload.message || payload.content).startsWith("E2E1:"),
                            wireHash: crypto
                                .createHash("sha256")
                                .update(String(payload.message || payload.content))
                                .digest("hex")
                        })
                        if (item.mode === "hold" && item.count === 1 && !releaseHeldSends)
                            await new Promise((resolve) => held.push(resolve))
                        const failReceipt = item.mode === "fail-once" && item.count === 1
                        if (failReceipt)
                            await pool.query("INSERT INTO qa_rejected_client_ids(client_id) VALUES($1)", [clientId])
                        const drop = item.mode.startsWith("lost-ack") && item.count === 1
                        suppressSuccess = drop
                        try {
                            const response = await new Promise((resolve, reject) => {
                                const timer = setTimeout(
                                    () => reject(new Error("Production message handler never acknowledged")),
                                    15000
                                )
                                handler(payload, (value) => {
                                    clearTimeout(timer)
                                    resolve(value)
                                })
                            })
                            events.push({ event: "send-ack", clientId, mode: item.mode, dropped: drop, ...response })
                            if (!drop) ack?.(response)
                        } finally {
                            suppressSuccess = false
                            if (failReceipt)
                                await pool.query("DELETE FROM qa_rejected_client_ids WHERE client_id=$1", [clientId])
                        }
                    })
                }
            if (property === "emit")
                return (event, ...args) => {
                    if (suppressSuccess && event === "message:send:success") return false
                    return target.emit(event, ...args)
                }
            const value = Reflect.get(target, property)
            return typeof value === "function" ? value.bind(target) : value
        }
    })
}
;(async () => {
    await fs.mkdir(output, { recursive: true })
    const initialSourceHashes = await readSourceHashes()
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-chat-send-"))
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
            `playtime-chat-pg-${suffix}`,
            "--label",
            "playtime.qa=chat-send",
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
            `playtime-chat-redis-${suffix}`,
            "--label",
            "playtime.qa=chat-send",
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
        JWT_SECRET_ENV: "isolated-chat-send-secret-not-production",
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
    await pool.query(
        "INSERT INTO users(id,username,email,password_hash,email_verified_at) VALUES(1,'alex','alex@example.test','test-only',NOW()),(2,'mira','mira@example.test','test-only',NOW())"
    )
    await pool.query("INSERT INTO friendships(user_id,friend_id,status) VALUES(1,2,'accepted')")
    await pool.query(`
        CREATE TABLE qa_rejected_client_ids(client_id TEXT PRIMARY KEY);
        CREATE FUNCTION qa_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF EXISTS(SELECT 1 FROM qa_rejected_client_ids WHERE client_id=NEW.client_message_id::text) THEN
                RAISE EXCEPTION 'Isolated QA receipt failure';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER qa_reject_receipt BEFORE INSERT ON message_send_receipts
        FOR EACH ROW EXECUTE FUNCTION qa_reject_receipt();
    `)
    const { createServer } = await import("vite"),
        { default: react } = await import("@vitejs/plugin-react")
    vite = await createServer({
        root,
        publicDir: path.join(root, "apps/frontend/public"),
        optimizeDeps: { entries: ["scripts/fixtures/chat-send-peer.tsx"] },
        cacheDir: path.join(temporary, "vite-cache"),
        configFile: false,
        define: {
            "process.env.REACT_APP_WEB_BUILD": '"true"',
            "process.env.REACT_APP_API_BASE": '"/playtime"',
            "process.env.REACT_APP_SOCKET_URL": '""'
        },
        server: {
            port: Number(process.env.CHAT_SEND_PORT || 4195),
            host: "127.0.0.1",
            strictPort: true,
            hmr: false,
            watch: null
        },
        plugins: [
            react(),
            {
                name: "chat-send-fixture",
                configureServer(server) {
                    server.middlewares.use("/__chat-send", async (_request, response) => {
                        response.setHeader("Content-Type", "text/html")
                        response.end(
                            await server.transformIndexHtml(
                                "/__chat-send",
                                '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/fixtures/chat-send-peer.tsx"></script></body></html>'
                            )
                        )
                    })
                }
            }
        ]
    })
    const { Server } = backendRequire("socket.io")
    const { attachSocketConnection } = require("../../apps/gateway/legacy/socket.ts")
    io = new Server(vite.httpServer, { path: "/qa-chat-socket" })
    io.on("connection", (socket) => {
        const id = Number(socket.handshake.auth.userId)
        assert.ok(id === 1 || id === 2)
        const user = { id, username: id === 1 ? "alex" : "mira" }
        socket.user = user
        socket.join(String(id))
        attachSocketConnection(io, faultSocket(socket, id), user)
    })
    await vite.listen()
    const base = `http://127.0.0.1:${vite.config.server.port}`
    browser = await chromium.launch({
        headless: true,
        ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {})
    })
    const pages = []
    for (const user of [1, 2]) {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
            serviceWorkers: "block"
        })
        const page = await context.newPage()
        page.on("pageerror", (error) => errors.push({ user, text: error.message }))
        await page.route("**/*", (route) => {
            const url = new URL(route.request().url())
            if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) return route.continue()
            if (
                url.hostname === "cdn.jsdelivr.net" &&
                /^\/gh\/(?:shuding\/fluentui-emoji-unicode|googlefonts\/noto-emoji@)/.test(url.pathname)
            ) {
                blockedEmojiAssets++
                return route.abort()
            }
            external.push(url.origin)
            return route.abort()
        })
        await page.goto(`${base}/__chat-send?user=${user}`)
        await page
            .getByTestId("session-ready")
            .filter({ hasText: /^ready$/ })
            .waitFor()
        pages.push(page)
    }
    const [sender, receiver] = pages
    const input = sender.getByPlaceholder("Сообщение…", { exact: true })
    await input.waitFor()
    const initialFocusLosses = (await snapshot(sender)).focusLosses
    nextModes.push("hold", "hold", "hold")
    for (const [index, text] of ["quick-alpha", "quick-beta", "quick-gamma"].entries()) {
        await input.fill(text)
        if (index === 1) await sender.getByRole("button", { name: "Отправить сообщение", exact: true }).click()
        else await input.press("Enter")
        await eventually(async () => (await bubble(sender, text).count()) === 1, "immediate optimistic " + text, 1500)
        await assertComposer(sender, "")
        assert.equal(await bubble(sender, text).getByLabel("Отправляется").count(), 1)
    }
    await input.fill("next draft must survive delayed acknowledgements")
    await assertComposer(sender, "next draft must survive delayed acknowledgements")
    assert.equal(
        (await snapshot(sender)).focusLosses,
        initialFocusLosses,
        "Neither Enter nor the send button blurs the text input"
    )
    await eventually(() => held.length === 1, "one ordered wire send is held while all three optimistic bubbles exist")
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM messages")).rows[0].count, 0)
    await capture(sender, "01-multiple-pending-focus")
    releaseHeldSends = true
    held.splice(0).forEach((release) => release())
    for (const text of ["quick-alpha", "quick-beta", "quick-gamma"])
        await bubble(sender, text).getByLabel("Отправлено", { exact: true }).waitFor()
    const committedOrder = (await snapshot(sender)).rows.sort((a, b) => Number(a.id) - Number(b.id))
    for (const [index, text] of ["quick-alpha", "quick-beta", "quick-gamma"].entries())
        assert(committedOrder[index].text.includes(text), "Server IDs preserve rapid-send order")
    assert.equal(
        new Set(requests.filter((request) => request.mode === "hold").map((request) => request.clientId)).size,
        3
    )
    const sentGlyph = await bubble(sender, "quick-alpha")
        .getByLabel("Отправлено", { exact: true })
        .locator("svg")
        .innerHTML()
    await assertComposer(sender, "next draft must survive delayed acknowledgements")
    await capture(sender, "02-sent-next-draft")
    await receiver.getByRole("button", { name: "Открыть тестовый чат", exact: true }).click()
    for (const text of ["quick-alpha", "quick-beta", "quick-gamma"])
        await bubble(sender, text).getByLabel("Прочитано", { exact: true }).waitFor()
    const readGlyph = await bubble(sender, "quick-alpha")
        .getByLabel("Прочитано", { exact: true })
        .locator("svg")
        .innerHTML()
    assert(sentGlyph && readGlyph && sentGlyph !== readGlyph, "One sent check changes to a distinct double-read check")
    await capture(sender, "03-peer-read")
    await receiver.getByRole("button", { name: "Закрыть тестовый чат", exact: true }).click()

    nextModes.push("lost-ack")
    await input.fill("lost-ack-unique")
    await input.press("Enter")
    await input.fill("draft while disconnected")
    await eventually(
        () => events.some((event) => event.mode === "lost-ack" && event.dropped && event.success),
        "lost ACK committed"
    )
    await eventually(
        () => requests.filter((request) => request.mode === "lost-ack").length >= 2,
        "same ID retry after lost ACK",
        20000
    )
    await bubble(sender, "lost-ack-unique").getByLabel("Отправлено", { exact: true }).waitFor()
    assert.equal(await bubble(sender, "lost-ack-unique").count(), 1)
    await assertComposer(sender, "draft while disconnected")
    const lostRequests = requests.filter((request) => request.mode === "lost-ack")
    assert.equal(new Set(lostRequests.map((request) => request.clientId)).size, 1)
    assert.equal(
        new Set(lostRequests.map((request) => request.wireHash)).size,
        1,
        "Lost ACK retries reuse the exact ciphertext"
    )
    assert(
        events.some((event) => event.mode === "lost-ack" && event.duplicate),
        "Retry receives the original durable receipt"
    )
    await capture(sender, "04-lost-ack-idempotent-retry")

    nextModes.push("lost-ack-reconnect")
    await input.fill("early-reconnect-unique")
    await input.press("Enter")
    await input.fill("draft across early reconnect")
    await eventually(
        () => events.some((event) => event.mode === "lost-ack-reconnect" && event.dropped && event.success),
        "second lost ACK committed"
    )
    await sender.evaluate(() => window.chatSendQa.socket.io.engine.close())
    await eventually(() => sender.evaluate(() => window.chatSendQa.socket.connected), "real socket reconnect")
    await bubble(sender, "early-reconnect-unique").getByLabel("Отправлено", { exact: true }).waitFor()
    assert.equal(await bubble(sender, "early-reconnect-unique").count(), 1)
    await assertComposer(sender, "draft across early reconnect")
    const earlyReconnectRows = (await pool.query("SELECT COUNT(*)::int AS count FROM messages")).rows[0].count
    assert.equal(earlyReconnectRows, 5, "History recovery keeps the committed message exactly once")
    await capture(sender, "05-lost-ack-early-reconnect")

    nextModes.push("fail-once")
    await input.fill("failed-then-retried")
    await input.press("Enter")
    await input.fill("draft preserved across retry")
    const failed = bubble(sender, "failed-then-retried")
    await failed.getByRole("button", { name: /Повторить/ }).waitFor()
    const failedRollbackRows = (await pool.query("SELECT COUNT(*)::int AS count FROM messages")).rows[0].count
    assert.equal(failedRollbackRows, 5, "Failed receipt transaction rolls the message back")
    await eventually(
        async () => (await pool.query("SELECT COUNT(*)::int AS count FROM qa_rejected_client_ids")).rows[0].count === 0,
        "the one-shot database fault is removed"
    )
    await assertComposer(sender, "draft preserved across retry")
    await capture(sender, "06-failed-next-draft")
    await failed.getByRole("button", { name: /Повторить/ }).click()
    await failed.getByLabel("Отправлено", { exact: true }).waitFor()
    assert.equal(await bubble(sender, "failed-then-retried").count(), 1)
    assert.equal(await input.isEnabled(), true)
    assert.equal(await input.inputValue(), "draft preserved across retry")
    const failRequests = requests.filter((request) => request.mode === "fail-once")
    assert.equal(failRequests.length, 2)
    assert.equal(new Set(failRequests.map((request) => request.clientId)).size, 1)
    assert.equal(
        new Set(failRequests.map((request) => request.wireHash)).size,
        1,
        "Failed-message retries reuse the exact ciphertext"
    )
    await assertComposer(sender, "draft preserved across retry")
    await capture(sender, "07-retried-no-duplicate")
    const sendFocusLosses = (await snapshot(sender)).focusLosses - initialFocusLosses
    assert.equal(sendFocusLosses, 0)

    await bubble(sender, "quick-alpha").click({ button: "right" })
    await sender.getByRole("menuitem", { name: "Изменить", exact: true }).click()
    const editingInput = sender.getByPlaceholder("Новый текст…", { exact: true })
    await editingInput.fill("quick-alpha-edited")
    holdPeerKeys = true
    await editingInput.press("Enter")
    await eventually(() => heldPeerKeys.length > 0, "the edit is waiting for its actual peer-key ACK")
    assert.equal((await pool.query("SELECT edited_at FROM messages WHERE id=1")).rows[0].edited_at, null)
    await editingInput.fill("new edit draft must survive delayed key ACK")
    const neutralControl = sender.getByRole("button", { name: "Закрыть тестовый чат", exact: true })
    await neutralControl.focus()
    const editBefore = await snapshot(sender)
    assert.equal(editBefore.focused, false)
    await capture(sender, "08-edit-pending-new-draft")
    holdPeerKeys = false
    heldPeerKeys.splice(0).forEach((release) => release())
    await bubble(sender, "quick-alpha-edited").waitFor()
    await eventually(
        async () => (await pool.query("SELECT edited_at FROM messages WHERE id=1")).rows[0].edited_at != null,
        "the actual encrypted edit commits"
    )
    await wait(100)
    assert.equal(
        await editingInput.inputValue(),
        "new edit draft must survive delayed key ACK",
        "An older edit completion preserves the new draft"
    )
    assert(
        await neutralControl.evaluate((element) => document.activeElement === element),
        "A late edit completion does not steal focus"
    )
    const editAfter = await snapshot(sender)
    assert.equal(editAfter.focusLosses, editBefore.focusLosses)
    await capture(sender, "09-edit-completed-draft-focus-preserved")
    const counts = (
        await pool.query(
            "SELECT (SELECT COUNT(*)::int FROM messages) AS messages, (SELECT COUNT(*)::int FROM message_send_receipts) AS receipts, (SELECT COUNT(*)::int FROM messages WHERE content NOT LIKE 'E2E1:%') AS plaintext"
        )
    ).rows[0]
    assert.deepEqual(counts, { messages: 6, receipts: 6, plaintext: 0 })
    assert(requests.every((request) => request.encrypted))
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    const sourceHashes = await readSourceHashes()
    assert.deepEqual(sourceHashes, initialSourceHashes, "Product source stayed frozen for the whole actual browser run")
    await fs.writeFile(
        path.join(output, "report.json"),
        JSON.stringify(
            {
                passed: true,
                scope: "Actual Chat UI, generated real E2EE keys, production attachSocketConnection/send/read/history and durable PostgreSQL receipts; isolated disposable PG/Redis",
                counts,
                failedRollbackRows,
                earlyReconnectRows,
                distinctSentAndReadGlyphs: sentGlyph !== readGlyph,
                committedOrder,
                sendFocusLosses,
                delayedEdit: {
                    passed: true,
                    before: editBefore,
                    after: editAfter,
                    focusStayedOnNeutralControl: true,
                    rowsAndReceiptsUnchanged: true
                },
                blockedEmojiAssets,
                requests,
                events,
                screenshots,
                sourceHashes,
                final: await snapshot(sender)
            },
            null,
            4
        ) + "\n"
    )
    console.log(JSON.stringify({ passed: true, counts, screenshots, output }))
})()
    .catch(async (error) => {
        if (browser)
            for (const [index, page] of browser
                .contexts()
                .flatMap((context) => context.pages())
                .entries()) {
                await capture(page, "failure-user" + (index + 1)).catch(() => {})
                await fs
                    .writeFile(
                        path.join(output, "failure-user" + (index + 1) + ".json"),
                        JSON.stringify(await snapshot(page), null, 4)
                    )
                    .catch(() => {})
            }
        await fs
            .writeFile(
                path.join(output, "failure.json"),
                JSON.stringify({ error: error.message, requests, events, errors, external }, null, 4)
            )
            .catch(() => {})
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        held.splice(0).forEach((release) => release())
        await browser?.close().catch(() => {})
        await new Promise((resolve) => (io ? io.close(resolve) : resolve()))
        await vite?.close().catch(() => {})
        await pool?.end().catch(() => {})
        if (redis) await redis.quit().catch(() => {})
        for (const id of containers.reverse())
            await exec("docker", ["rm", "-f", id], { timeout: 30000 }).catch(() => {})
        if (temporary) await fs.rm(temporary, { recursive: true, force: true })
        process.exit(process.exitCode || 0)
    })
