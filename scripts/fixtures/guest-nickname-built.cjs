const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const crypto = require("node:crypto")
const { io: connect } = require("socket.io-client")
const nacl = require("tweetnacl")
module.exports = async function builtGuestQa(context) {
    const {
        pool,
        redis,
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
        forceBusy
    } = context
    const clients = []
    const keys = new Map()
    const assetHashes = async () => {
        const result = {}
        const walk = async (directory) => {
            for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
                const file = path.join(directory, entry.name)
                if (entry.isDirectory()) await walk(file)
                else
                    result[path.relative(builtWeb, file)] = crypto
                        .createHash("sha256")
                        .update(await fs.readFile(file))
                        .digest("hex")
            }
        }
        await walk(builtWeb)
        return result
    }
    const initialAssets = await assetHashes()
    const servedResponse = await fetch(base + "/playtime/app/")
    assert.equal(servedResponse.status, 200)
    const servedHtml = await servedResponse.text()
    assert.equal(
        servedHtml,
        await fs.readFile(path.join(builtWeb, "index.html"), "utf8"),
        "served HTML is byte-identical to shipped index"
    )
    const csp = servedHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]
    assert.ok(csp?.includes("script-src 'self' 'wasm-unsafe-eval'"), "shipped production CSP remains active")
    await fs.writeFile(path.join(output, "served-index.html"), servedHtml)
    const htmlProof = {
        sha256: crypto.createHash("sha256").update(servedHtml).digest("hex"),
        csp,
        scripts: [...servedHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1])
    }
    const bubble = (page, text) => page.locator("[data-msg-id]").filter({ hasText: text })
    const contacts = (page) => page.getByRole("button", { name: "Друзья", exact: true }).click()
    const row = (page, name, archived = false) => {
        const rows = page
            .locator("li")
            .filter({ hasText: name })
            .filter({ has: page.getByRole("button", { name: "Написать", exact: true }) })
        return archived
            ? rows.filter({ hasText: /Гостевой аккаунт завершён|Гость вышел/ })
            : rows.filter({ hasNotText: /Гостевой аккаунт завершён|Гость вышел/ })
    }
    const choose = async (page, name, archived = false) => {
        await contacts(page)
        await row(page, name, archived).getByRole("button", { name: "Написать", exact: true }).click()
    }
    const send = async (page, text) => {
        await page.getByPlaceholder("Сообщение…", { exact: true }).fill(text)
        await page.getByPlaceholder("Сообщение…", { exact: true }).press("Enter")
        await bubble(page, text)
            .getByLabel(/^(Отправлено|Прочитано)$/)
            .waitFor()
    }
    const ack = (client, event, payload = {}) =>
        new Promise((resolve, reject) =>
            client.timeout(12000).emit(event, payload, (error, data) => (error ? reject(error) : resolve(data)))
        )
    const open = async (id) => {
        let key = keys.get(id)
        if (!key) {
            const pair = nacl.box.keyPair()
            key = {
                secret: Buffer.from(pair.secretKey).toString("base64"),
                public: Buffer.from(pair.publicKey).toString("base64")
            }
            keys.set(id, key)
            await pool.query("UPDATE users SET dm_public_key=$1 WHERE id=$2", [key.public, id])
        }
        const session = sessions.get(id)
        const browserContext = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
            serviceWorkers: "block"
        })
        await browserContext.addInitScript(
            ({ token, refreshToken, secret, userId }) => {
                if (!localStorage.getItem("qa-bootstrap-complete")) {
                    localStorage.setItem("token", token)
                    localStorage.setItem("refreshToken", refreshToken)
                    localStorage.setItem(`playtime_dm_secret_key_b64:${userId}`, secret)
                    localStorage.setItem("qa-bootstrap-complete", "1")
                }
            },
            { token: session.token, refreshToken: session.refreshToken, secret: key.secret, userId: id }
        )
        const page = await browserContext.newPage()
        page.on("pageerror", (error) => errors.push(error.stack || error.message))
        await page.route("**/*", (route) => {
            const url = new URL(route.request().url())
            if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) return route.continue()
            if (url.hostname !== "cdn.jsdelivr.net") external.push(url.origin)
            return route.abort()
        })
        await page.goto(base + "/playtime/app/#/content")
        await page.getByRole("button", { name: "Друзья", exact: true }).waitFor()
        const client = connect(base, {
            path: "/playtime/socket.io",
            transports: ["websocket"],
            auth: { token: session.token, peerIdentityProtocol: 1, callProtocol: 2 }
        })
        clients.push(client)
        await new Promise((resolve, reject) => {
            client.once("connect", resolve)
            client.once("connect_error", reject)
        })
        const received = []
        client.on("message:receive", (data) => received.push(data.id))
        return { page, client, received }
    }
    try {
        const a = await open(alice.id)
        const previous = await open(old.user.id)
        await choose(a.page, "Moon")
        await choose(previous.page, "Alice")
        await send(a.page, "old Moon private history")
        await bubble(previous.page, "old Moon private history").waitFor()
        await bubble(a.page, "old Moon private history").getByLabel("Прочитано", { exact: true }).waitFor()
        const original = (await pool.query("SELECT id,sender_id,receiver_id,content FROM messages ORDER BY id")).rows
        assert.equal(original.length, 1)
        assert.match(original[0].content, /^E2E1:/)
        await capture(a.page, "built-01-before-logout-desktop")
        await previous.page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click()
        await previous.page.getByRole("button", { name: "Выйти без регистрации", exact: true }).click()
        await eventually(
            async () =>
                !!(await pool.query("SELECT guest_archived_at FROM users WHERE id=$1", [old.user.id])).rows[0]
                    .guest_archived_at,
            "actual shipped app logout archives old guest"
        )
        await a.page.getByRole("status").filter({ hasText: "Гостевой аккаунт завершён" }).waitFor()
        assert.equal(await a.page.locator("textarea").count(), 0)
        assert.equal(await a.page.getByRole("button", { name: "Позвонить", exact: true }).count(), 0)
        assert.deepEqual(
            (await pool.query("SELECT id,sender_id,receiver_id,content FROM messages ORDER BY id")).rows,
            original
        )
        for (const key of await redis.keys("guest_register_lock:*")) await redis.del(key)
        const fresh = await http(base, "guest", {
            username: "Moon",
            requestKey: crypto.randomBytes(32).toString("hex")
        })
        sessions.set(fresh.user.id, fresh)
        assert.notEqual(fresh.user.id, old.user.id)
        await capture(a.page, "built-02-archived-history-desktop")
        await a.page.setViewportSize({ width: 390, height: 844 })
        await capture(a.page, "built-03-archived-history-390")
        await a.page.setViewportSize({ width: 1440, height: 1000 })
        const b = await open(fresh.user.id)
        await contacts(a.page)
        await a.page.getByPlaceholder("Введите никнейм").fill("Moon")
        await a.page.getByRole("button", { name: "Отправить заявку", exact: true }).click()
        await contacts(b.page)
        await b.page.getByRole("button", { name: "Принять заявку", exact: true }).click()
        await eventually(
            async () =>
                (await ack(a.client, "friend:list")).some(
                    (friend) => friend.other_user_id === fresh.user.id && friend.status === "accepted"
                ),
            "new same-name identity accepted"
        )
        await eventually(
            async () =>
                (await a.page
                    .locator("li")
                    .filter({ hasText: "Moon" })
                    .filter({ has: a.page.getByRole("button", { name: "Написать", exact: true }) })
                    .count()) === 2,
            "actual built contacts have both stable identities"
        )
        if (forceBusy) {
            const faultStart = events.length
            forceBusy(alice.id)
            await eventually(
                () => events.slice(faultStart).filter((event) => event.event === "forced-busy-ack").length === 2,
                "both deterministic busy list ACKs injected"
            )
            assert.equal(
                await a.page.getByRole("button", { name: "Друзья", exact: true }).count(),
                1,
                "AppShell survives non-array ACKs"
            )
            assert.equal(
                await a.page
                    .locator("li")
                    .filter({ hasText: "Moon" })
                    .filter({ has: a.page.getByRole("button", { name: "Написать", exact: true }) })
                    .count(),
                2,
                "last valid old/new contacts preserved during busy retry"
            )
            for (const requestEvent of ["friend:list", "room:list"]) {
                const rejection = events.findIndex(
                    (event, index) =>
                        index >= faultStart && event.event === "forced-busy-ack" && event.requestEvent === requestEvent
                )
                await eventually(
                    () =>
                        events.some(
                            (event, index) =>
                                index > rejection &&
                                event.event === "ack-array" &&
                                event.requestEvent === requestEvent &&
                                event.userId === alice.id
                        ),
                    `${requestEvent} automatically retries to valid array`
                )
            }
            assert.deepEqual(errors, [], "busy list ACK never crashes the built shell")
            await capture(a.page, "built-busy-list-recovered-desktop")
        }
        await capture(a.page, "built-04-two-distinct-contacts-desktop")
        await row(a.page, "Moon").getByRole("button", { name: "Написать", exact: true }).click()
        await a.page.getByPlaceholder("Сообщение…", { exact: true }).waitFor()
        assert.equal(await bubble(a.page, "old Moon private history").count(), 0)
        await row(b.page, "Alice").getByRole("button", { name: "Написать", exact: true }).click()
        await send(a.page, "new Moon separate encrypted history")
        await bubble(b.page, "new Moon separate encrypted history").waitFor()
        await bubble(a.page, "new Moon separate encrypted history").getByLabel("Прочитано", { exact: true }).waitFor()
        await capture(a.page, "built-05-new-identity-chat-desktop")
        await a.page.setViewportSize({ width: 390, height: 844 })
        await capture(a.page, "built-06-new-identity-chat-390")
        await a.page.setViewportSize({ width: 1440, height: 1000 })
        await choose(a.page, "Moon", true)
        await bubble(a.page, "old Moon private history").waitFor()
        await send(b.page, "incoming new holder never joins old chat")
        const incomingId = (
            await pool.query("SELECT id FROM messages WHERE sender_id=$1 ORDER BY id DESC LIMIT 1", [fresh.user.id])
        ).rows[0].id
        await eventually(() => a.received.includes(incomingId), "new-holder live event reaches Alice sockets")
        assert.equal(await bubble(a.page, "incoming new holder never joins old chat").count(), 0)
        assert.equal(await bubble(a.page, "new Moon separate encrypted history").count(), 0)
        for (const payload of [
            { username: "Moon", peerUserId: old.user.id },
            { username: "Moon", peerUserId: "invalid" },
            { username: "Moon" }
        ]) {
            assert.ok((await ack(a.client, "call:start", payload)).err)
            assert.ok(
                (
                    await ack(a.client, "message:send", {
                        ...payload,
                        message: original[0].content,
                        clientMessageId: crypto.randomUUID()
                    })
                ).err
            )
        }
        const persisted = (await pool.query("SELECT id,sender_id,receiver_id,content FROM messages ORDER BY id")).rows
        assert.deepEqual(persisted[0], original[0])
        assert.equal(persisted.length, 3)
        assert(
            persisted
                .slice(1)
                .every(
                    (message) =>
                        [message.sender_id, message.receiver_id].includes(fresh.user.id) &&
                        ![message.sender_id, message.receiver_id].includes(old.user.id)
                )
        )
        assert.deepEqual(errors, [])
        assert.equal(external.length, 0)
        assert.deepEqual(await sourceHashes(), initialHashes, "product sources unchanged")
        assert.deepEqual(await assetHashes(), initialAssets, "exact shipped assets unchanged")
        await fs.writeFile(
            path.join(output, "result.json"),
            JSON.stringify(
                {
                    passed: true,
                    mode: "exact-shipped-web",
                    htmlProof,
                    forcedBusy: !!forceBusy,
                    builtWeb,
                    browserVersion: browser.version(),
                    aliceId: alice.id,
                    oldGuestId: old.user.id,
                    newGuestId: fresh.user.id,
                    persistedMessages: persisted.map(({ id, sender_id, receiver_id }) => ({
                        id,
                        sender_id,
                        receiver_id
                    })),
                    sourceHashes: initialHashes,
                    builtAssetHashes: initialAssets,
                    events
                },
                null,
                4
            ) + "\n"
        )
        console.log(JSON.stringify({ passed: true, mode: "exact-shipped-web", output }))
    } finally {
        for (const client of clients) client.disconnect()
    }
}
