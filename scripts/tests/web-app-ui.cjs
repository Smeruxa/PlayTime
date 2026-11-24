const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const http = require("node:http")
const { once } = require("node:events")
const { createRequire } = require("node:module")
const { createDecipheriv, pbkdf2Sync } = require("node:crypto")
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const browserType = playwright[process.env.WEB_BROWSER_ENGINE || "chromium"]
const requestedDevice = process.env.WEB_APP_DEVICE && playwright.devices[process.env.WEB_APP_DEVICE]
if (process.env.WEB_APP_DEVICE) assert.ok(requestedDevice, "Unknown Playwright device preset")
const { defaultBrowserType: _deviceEngine, ...deviceOptions } = requestedDevice || {}
const nacl = require("tweetnacl")
require("tsx/cjs")
const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const express = backendRequire("express")
const { Server } = backendRequire("socket.io")
const { listPlansPublic } = require("../../apps/shared/subscription/planCatalog.ts")
const output = process.env.WEB_APP_SCREENSHOT_DIR || path.join(root, "artifacts/web-app-qa")
const useBuild = process.env.WEB_APP_UI_BUILD === "1"
const widths = process.env.WEB_APP_WIDTHS ? process.env.WEB_APP_WIDTHS.split(",").map(Number) : [1440, 1024, 390]
const password = "browser-test-password-2026"
const code = "012345"
const peerKey = nacl.box.keyPair()
const peerPublicKey = Buffer.from(peerKey.publicKey).toString("base64")
const users = new Map(),
    tokens = new Map(),
    refreshTokens = new Map(),
    guestClaims = new Map(),
    refreshReplays = new Map(),
    responseFaults = new Map()
const retiredTransportIds = new Set(),
    transportErrors = new Map()
const requests = [],
    sentMessages = [],
    socketEvents = new Set(),
    unknownEvents = new Set(),
    errors = [],
    consoleErrors = [],
    httpErrors = [],
    external = [],
    localEmojiFixtures = [],
    layoutIssues = [],
    tabChecks = [],
    unknownHttp = [],
    refreshRequests = [],
    refreshTrace = [],
    backupChecks = [],
    failureChecks = []
let nextId = 700,
    nextMessage = 1000,
    browser,
    server,
    io,
    vite,
    currentPage
const persistentContexts = new Set(),
    temporaryProfiles = []
const browserOptions = () => ({
    headless: true,
    timeout: 20000,
    ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {}),
    ...(!process.env.WEB_BROWSER_ENGINE || process.env.WEB_BROWSER_ENGINE === "chromium"
        ? { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }
        : {})
})
function recordHttpError(response, details) {
    if (response.status() < 400) return
    const url = new URL(response.url()),
        protocol = transportErrors.get(url.searchParams.get("sid"))
    const expectedRetiredTransport =
        url.pathname === "/playtime/socket.io/" && response.status() === 400 && protocol?.code === 1 && protocol.retired
    httpErrors.push({
        ...details,
        path: url.pathname,
        status: response.status(),
        ...(expectedRetiredTransport ? { expectedRetiredTransport: true } : {})
    })
}
const userWire = (user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    isGuest: user.isGuest,
    registrationPending: user.registrationPending
})
function session(user) {
    user.rotation = (user.rotation || 0) + 1
    const token = [
        "eyJhbGciOiJub25lIn0",
        Buffer.from(
            JSON.stringify({
                id: user.id,
                username: user.username,
                sid: `fixture-session-${user.id}`,
                jti: `fixture-${user.rotation}`,
                exp: Math.floor(Date.now() / 1000) + 3600
            })
        ).toString("base64url"),
        `fixture-${user.id}-${user.rotation}`
    ].join(".")
    const refreshToken = `isolated-refresh-${user.id}-${user.rotation}`
    tokens.set(token, user)
    refreshTokens.set(refreshToken, user)
    return { token, refreshToken, expiresIn: 3600, user: userWire(user) }
}
function createUser(username, email = null) {
    const user = {
        id: ++nextId,
        username,
        email,
        isGuest: !email,
        registrationPending: false,
        verified: false,
        publicKey: null,
        rooms: email ? [] : [{ id: 501, name: "Команда", created_by: nextId }],
        messages: new Map(),
        call: null
    }
    users.set(username, user)
    return user
}
function profile(user, username) {
    const own = !username || username === user.username
    return {
        username: own ? user.username : username,
        email: own ? user.email : undefined,
        status: own ? "На связи" : "Обсуждаем идеи",
        bio: "Планы, разговоры и немного хорошего настроения.",
        avatar: null,
        profileBanner: null,
        profileAvatarEffect: "none",
        profileBannerEffect: "none",
        profileBannerSticker: "none",
        createdAt: "2026-10-01T10:00:00.000Z",
        isSelf: own,
        dmPublicKey: own ? user.publicKey : peerPublicKey
    }
}
function friends(user) {
    if (user.username.startsWith("member")) return []
    return ["mira", "dan", "longincomingusername"].map((name, index) => ({
        id: 40 + index,
        user_id: index === 2 ? 42 : user.id,
        friend_id: index === 2 ? user.id : 40 + index,
        status: index === 2 ? "pending" : "accepted",
        direction: index === 2 ? "incoming" : undefined,
        friend_username: name,
        other_user_id: 40 + index,
        friend_archived: false,
        is_room: false
    }))
}
function wireMessage(user, payload, id, content, me = true) {
    const peerId = payload.roomId ? null : payload.peerUserId
    if (!payload.roomId) assert.ok(Number.isSafeInteger(peerId) && peerId > 0)
    return {
        id,
        sender_id: me ? user.id : peerId,
        receiver_id: me ? peerId : user.id,
        sender_username: me ? user.username : "mira",
        receiver_username: me ? payload.username : user.username,
        content,
        created_at: new Date(Date.now() - (me ? 0 : 120000)).toISOString(),
        me,
        read: !me,
        is_dm_e2ee: !payload.roomId,
        sender_dm_public_key: me ? user.publicKey : peerPublicKey,
        receiver_dm_public_key: me ? peerPublicKey : user.publicKey
    }
}
function encryptedIncoming(user) {
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const ciphertext = nacl.box(
        new TextEncoder().encode("Привет! Проверим, как работает веб-версия?"),
        nonce,
        Buffer.from(user.publicKey, "base64"),
        peerKey.secretKey
    )
    return (
        "E2E1:" +
        JSON.stringify({ n: Buffer.from(nonce).toString("base64"), b: Buffer.from(ciphertext).toString("base64") })
    )
}
async function fixture() {
    const app = express()
    if (useBuild) app.use(backendRequire("helmet")())
    app.use(express.json())
    app.use((req, _res, next) => {
        requests.push({ method: req.method, path: req.path })
        next()
    })
    app.post("/playtime/auth/guest", (req, res) => {
        if (!/^[a-f0-9]{64}$/.test(req.body.requestKey || ""))
            return res.status(400).json({ error: "Guest retry proof required by the browser fixture" })
        const previous = guestClaims.get(req.body.username)
        if (previous?.requestKey === req.body.requestKey && refreshTokens.has(previous.response.refreshToken))
            return res.json(previous.response)
        if (req.body.username === "taken" || users.has(req.body.username))
            return res.status(409).json({ error: "Этот никнейм уже занят. Попробуйте другой." })
        const response = session(createUser(req.body.username))
        guestClaims.set(req.body.username, { requestKey: req.body.requestKey, response })
        if (responseFaults.delete(`guest:${req.body.username}`)) {
            res.status(200).type("json").write('{"token":')
            return
        }
        res.json(response)
    })
    app.post("/playtime/auth/tokenValid", (req, res) => {
        const user = tokens.get(req.body.token)
        return user ? res.json({ valid: true, user: userWire(user) }) : res.status(401).json({ valid: false })
    })
    app.post("/playtime/auth/refresh", async (req, res) => {
        const previous = refreshReplays.get(req.body.refreshToken)
        const replay = previous?.requestKey === req.body.requestKey && refreshTokens.has(previous.response.refreshToken)
        const user = refreshTokens.get(req.body.refreshToken)
        refreshRequests.push({
            revision: req.body.refreshToken?.split("-").at(-1),
            at: Date.now(),
            valid: !!user || !!replay,
            replay: !!replay,
            hasProof: /^[a-f0-9]{64}$/.test(req.body.requestKey || "")
        })
        if (replay) return res.json(previous.response)
        if (!user || !/^[a-f0-9]{64}$/.test(req.body.requestKey || ""))
            return res.status(401).json({ error: "Session revoked" })
        refreshTokens.delete(req.body.refreshToken)
        const response = session(user)
        refreshReplays.set(req.body.refreshToken, { requestKey: req.body.requestKey, response })
        if (responseFaults.delete(`refresh:${user.id}`)) {
            res.status(200).type("json").write('{"token":')
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return res.json(response)
    })
    app.post("/playtime/auth/guest/upgrade", (req, res) => {
        const user = tokens.get(req.get("authorization")?.replace("Bearer ", ""))
        if (!user?.isGuest) return res.status(403).json({ error: "Guest required" })
        user.email = req.body.email
        user.registrationPending = true
        res.json({ user: userWire(user), verificationRequired: true })
    })
    app.post("/playtime/auth/guest/change-email", (req, res) => {
        const user = tokens.get(req.get("authorization")?.replace("Bearer ", ""))
        if (!user?.isGuest || !user.registrationPending)
            return res.status(403).json({ error: "Pending guest required" })
        if (req.body.password !== password) return res.status(401).json({ error: "Неверный пароль аккаунта." })
        user.email = req.body.email
        res.json({ user: userWire(user), verificationRequired: true })
    })
    app.post("/playtime/auth/register", (req, res) => {
        const user = createUser(req.body.username, req.body.email)
        user.registrationPending = true
        res.json({ user: userWire(user), verificationRequired: true })
    })
    app.post("/playtime/auth/email-verification/request", (_req, res) => res.json({ success: true }))
    app.post("/playtime/auth/email-verification/confirm", (req, res) => {
        const user = Array.from(users.values()).find((user) => user.email === req.body.email)
        if (!user || req.body.code !== code) return res.status(400).json({ error: "Неверный код подтверждения" })
        user.isGuest = false
        user.registrationPending = false
        user.verified = true
        res.json({ success: true })
    })
    app.post("/playtime/auth/login", (req, res) => {
        const user = Array.from(users.values()).find((user) => user.email === req.body.email)
        if (!user?.verified || req.body.password !== password)
            return res.status(401).json({ error: "Неверный email или пароль." })
        res.json(session(user))
    })
    app.post("/playtime/auth/recovery/request", (_req, res) => res.json({ message: "Проверьте почту и папку Спам." }))
    app.post("/playtime/auth/recovery/reset", (req, res) =>
        req.body.code === code ? res.json({ success: true }) : res.status(400).json({ error: "Неверный код" })
    )
    app.post("/playtime/auth/revoke", (req, res) => {
        tokens.delete(req.body.token)
        refreshTokens.delete(req.body.refreshToken)
        res.json({ success: true })
    })
    app.get("/playtime/auth/sessions", (_req, res) =>
        res.json({
            sessions: [
                {
                    id: "fixture-session",
                    deviceName: "PlayTime · браузер",
                    current: true,
                    createdAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString()
                }
            ]
        })
    )
    app.get("/playtime/subscription/me", (_req, res) =>
        res.json({ planSlug: "free", limits: listPlansPublic()[0].limits })
    )
    app.get("/playtime/subscription/plans", (_req, res) => res.json({ plans: listPlansPublic() }))
    if (useBuild) {
        process.env.NODE_ENV = "production"
        process.env.WEB_DIST_PATH = path.join(root, "web-dist")
        const { attachWebApp } = require("../../apps/gateway/http/serveSite.ts")
        assert.equal(attachWebApp(app), true, "Build the web application before using WEB_APP_UI_BUILD=1")
    }
    app.use((req, res) => {
        unknownHttp.push(`${req.method} ${req.path}`)
        res.status(404).json({ error: "Unknown isolated fixture endpoint" })
    })
    server = http.createServer(app)
    io = new Server(server, { path: "/playtime/socket.io" })
    io.engine.on("connection", (transport) => transport.on("close", () => retiredTransportIds.add(transport.id)))
    io.engine.on("connection_error", (error) => {
        const sid = new URL(error.req.url, "http://fixture").searchParams.get("sid")
        if (sid)
            transportErrors.set(sid, {
                code: error.code,
                message: error.message,
                retired: retiredTransportIds.has(sid)
            })
    })
    io.use((socket, next) => {
        socket.data.user = tokens.get(socket.handshake.auth.token)
        next(socket.data.user ? undefined : new Error("Invalid fixture session"))
    })
    io.on("connection", (socket) => {
        const user = socket.data.user
        socket.onAny((event, ...args) => {
            socketEvents.add(event)
            const payload = typeof args[0] === "object" && args[0] ? args[0] : {}
            const ack = typeof args.at(-1) === "function" ? args.at(-1) : () => {}
            switch (event) {
                case "get:username":
                    return ack({ username: user.username, userId: user.id })
                case "call:current":
                    return ack({ state: user.call })
                case "call:confirm": {
                    user.call = payload.accept
                        ? {
                              roomId: payload.roomId,
                              status: "in_call",
                              revision: 2,
                              caller: { id: 40, username: "mira" },
                              receiver: { id: user.id, username: user.username }
                          }
                        : null
                    return ack({ success: true, state: user.call })
                }
                case "call:resume":
                    return ack({ success: true, status: "in_call" })
                case "call:end":
                    user.call = null
                    return socket.emit("call:ended", { roomId: payload.roomId })
                case "webrtc:config:request":
                    return socket.emit("webrtc:config", { iceServers: [{ urls: "stun:127.0.0.1:9" }] })
                case "ping:measure":
                    return ack(args[0])
                case "profile:get":
                    return ack({ profile: profile(user, payload.username) })
                case "profile:setDmPublicKey":
                    user.publicKey = payload.publicKey
                    return ack({ success: true })
                case "profile:getDmPublicKey":
                    return ack({ publicKey: peerPublicKey })
                case "profile:friendsAvatars":
                    return ack({})
                case "friend:list":
                    return ack(friends(user))
                case "friend:outgoingList":
                    return ack(["alex"])
                case "presence:list":
                    return ack(["mira"])
                case "presence:listByUserId":
                    assert.equal(args.length, 1, "Production presence identity request is callback-only")
                    return ack([40])
                case "friend:outgoingIdentities":
                    return ack([{ userId: 43, username: "alex", archived: false }])
                case "message:lastPreviews":
                    return ack({
                        dm: { mira: { from: "mira", content: "Привет! Проверим веб-версию?" } },
                        rooms: { 501: { from: "dan", content: "Встречаемся здесь вечером" } }
                    })
                case "room:list":
                    return ack(user.rooms)
                case "room:create": {
                    const room = { id: 600 + user.id, name: payload.name, created_by: user.id }
                    user.rooms.push(room)
                    return ack({ success: true, roomId: room.id, name: room.name })
                }
                case "room:get":
                    return ack({
                        members: [
                            { id: user.id, username: user.username, role: "owner" },
                            { id: 40, username: "mira", role: "member" }
                        ],
                        created_by: user.id,
                        myId: user.id
                    })
                case "room:e2eeBundle":
                    return ack({
                        members: [{ id: user.id, username: user.username, dmPublicKey: user.publicKey }],
                        wrapCount: 0,
                        myWrap: null
                    })
                case "room:e2eePutWraps":
                    return ack({ success: true })
                case "dmWallpaper:get":
                    return ack({ state: { kind: "none" } })
                case "message:getMessages": {
                    const key = payload.roomId ? `room:${payload.roomId}` : payload.username
                    if (!user.messages.has(key))
                        user.messages.set(
                            key,
                            payload.roomId ? [] : [wireMessage(user, payload, 99, encryptedIncoming(user), false)]
                        )
                    return socket.emit("message:getMessages:success", {
                        requestId: payload.requestId,
                        messages: user.messages.get(key),
                        hasMore: false,
                        roomReadWatermark: 0,
                        pinnedMessageId: null
                    })
                }
                case "message:send": {
                    const content = payload.message || payload.content,
                        id = ++nextMessage
                    assert.match(content, payload.roomId ? /^R2E1:/ : /^E2E1:/)
                    const message = wireMessage(user, payload, id, content)
                    const key = payload.roomId ? `room:${payload.roomId}` : payload.username
                    user.messages.set(key, [...(user.messages.get(key) || []), message])
                    sentMessages.push({ id, userId: user.id, room: !!payload.roomId, encrypted: true })
                    if (payload.roomId)
                        socket.emit("message:receive", { ...message, from: user.username, roomId: payload.roomId })
                    else
                        socket.emit("message:send:success", {
                            ...message,
                            senderDmPublicKey: user.publicKey,
                            receiverDmPublicKey: peerPublicKey
                        })
                    return ack({ success: true, id })
                }
                case "chat:typing":
                case "message:markRead":
                case "message:markRoomRead":
                case "auth:refresh":
                case "call:heartbeat":
                case "webrtc:screen:state":
                    return ack({ success: true })
                default:
                    unknownEvents.add(event)
                    return ack({})
            }
        })
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    if (useBuild) return `http://127.0.0.1:${server.address().port}/playtime/app/`
    process.env.WEB_PROXY_TARGET = `http://127.0.0.1:${server.address().port}`
    const { createServer } = await import("vite")
    vite = await createServer({
        configFile: path.join(root, "vite.web.config.mts"),
        server: {
            port: Number(process.env.WEB_APP_UI_PORT || 4186),
            host: "127.0.0.1",
            strictPort: true,
            open: false,
            hmr: false
        }
    })
    await vite.listen()
    return `http://127.0.0.1:${vite.config.server.port}/playtime/app/`
}
async function screenshot(page, name, width) {
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(220)
    const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth > innerWidth + 1,
        body: document.body.scrollWidth > innerWidth + 1
    }))
    if (overflow.document || overflow.body) layoutIssues.push({ name, width, overflow })
    await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true })
}
async function go(page, name) {
    await page.getByRole("button", { name, exact: true }).first().click()
}
const message = (page, text) => page.locator('[class*="bubbleText"]').filter({ hasText: text }).first()
async function acceptTerms(page) {
    await page.getByRole("checkbox").press("Space")
    assert.equal(await page.getByRole("checkbox").isChecked(), true)
}
async function verifyEmail(page) {
    await page.getByLabel("Код из письма", { exact: true }).fill(code)
    await go(page, "Подтвердить почту")
    await page.getByRole("heading", { name: "Почта подтверждена" }).waitFor()
}
async function checkWidth(base, width, height) {
    const context = await browser.newContext({
        ...(width < 700 ? deviceOptions : {}),
        ...(width < 700 && process.env.WEB_APP_TOUCH === "1" ? { hasTouch: true } : {}),
        viewport: { width, height },
        reducedMotion: "reduce",
        serviceWorkers: "block"
    })
    context.on("page", (tab) => {
        tab.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push({ width, message: message.text() })
        })
        tab.on("response", (response) => recordHttpError(response, { width }))
    })
    if (process.env.WEB_APP_REFRESH_TRACE === "1") {
        await context.addInitScript(() => {
            const pageId = Math.random().toString(36).slice(2, 6)
            const revision = () => localStorage.getItem("refreshToken")?.split("-").at(-1)
            window.__refreshTrace = []
            const trace = (phase, key) =>
                window.__refreshTrace.push({ pageId, phase, key, revision: revision(), at: Date.now() })
            const originalLock = navigator.locks.request.bind(navigator.locks)
            navigator.locks.request = (...args) => {
                if (args[0] !== "playtime:auth-refresh") return originalLock(...args)
                const callback = args.at(-1)
                trace("request")
                args[args.length - 1] = async (lock) => {
                    trace("grant")
                    try {
                        return await callback(lock)
                    } finally {
                        trace("done")
                    }
                }
                return originalLock(...args)
            }
            const originalSet = Storage.prototype.setItem
            Storage.prototype.setItem = function (key, value) {
                originalSet.call(this, key, value)
                if (this === localStorage && ["token", "refreshToken"].includes(key)) trace("set", key)
            }
            window.addEventListener("storage", (event) => {
                if (["token", "refreshToken"].includes(event.key)) trace("storage", event.key)
            })
        })
    }
    const page = await context.newPage()
    currentPage = page
    page.setDefaultTimeout(15000)
    page.on("pageerror", (error) => {
        errors.push({ width, message: error.message })
        console.error("Page error:", error.message)
    })
    await context.route("**/*", (route) => {
        const url = new URL(route.request().url())
        if (url.hostname === "cdn.jsdelivr.net" && route.request().resourceType() === "image") {
            localEmojiFixtures.push(url.pathname)
            return route.fulfill({
                contentType: "image/svg+xml",
                body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#ffd35b"/><circle cx="11" cy="12" r="2"/><circle cx="21" cy="12" r="2"/><path d="M9 19q7 9 14 0" fill="none" stroke="#3d2c19" stroke-width="2" stroke-linecap="round"/></svg>'
            })
        }
        if (url.origin !== new URL(base).origin && url.protocol !== "data:" && url.protocol !== "blob:") {
            external.push(url.origin)
            return route.abort()
        }
        return route.continue()
    })
    const username = `guest${width}`,
        email = `${username}@example.test`
    console.log("Checking actual web app", width)
    const initialResponse = await page.goto(base)
    if (useBuild) {
        assert.equal(initialResponse.status(), 200)
        assert.equal(initialResponse.headers()["cache-control"], "no-cache")
        assert.match(initialResponse.headers()["content-security-policy"], /script-src 'self' 'wasm-unsafe-eval'/)
        assert.doesNotMatch(initialResponse.headers()["content-security-policy"], /script-src[^;]*'unsafe-inline'/)
    }
    await page.getByRole("button", { name: /Войти по нику/ }).waitFor()
    await screenshot(page, "welcome", width)
    await page.getByRole("button", { name: /Войти по нику/ }).click()
    await page.getByLabel("Никнейм", { exact: true }).fill("taken")
    await go(page, "Начать общение")
    await page.getByRole("alert").waitFor()
    await screenshot(page, "guest-name-error", width)
    await page.getByLabel("Никнейм", { exact: true }).fill(username)
    await go(page, "Начать общение")
    await page.getByRole("complementary", { name: "Регистрация аккаунта" }).waitFor()
    await page.getByRole("complementary", { name: "Список чатов" }).getByText("mira", { exact: true }).waitFor()
    const guestId = users.get(username).id
    await screenshot(page, "guest-reminder", width)
    if (width <= 390) {
        await page.screenshot({
            path: path.join(output, `reminder-detail-${width}.png`),
            clip: { x: 0, y: height - 330, width: Math.min(width, 370), height: 330 }
        })
    }
    if (width === 320) {
        await context.close()
        return
    }
    await go(page, "Закрыть подсказку о регистрации")
    await page.reload()
    await page.getByRole("button", { name: "Зарегистрировать аккаунт", exact: true }).waitFor()
    assert.equal(await page.getByRole("complementary", { name: "Регистрация аккаунта" }).count(), 0)
    await screenshot(page, "guest-reminder-dismissed", width)
    if (width < 700) {
        await go(page, "Выйти из аккаунта")
        await page.getByRole("dialog", { name: "Выйти из аккаунта?" }).waitFor()
        await screenshot(page, "guest-logout", width)
        await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click()
        const connectedDeadline = Date.now() + 15000
        let target
        while (!target && Date.now() < connectedDeadline) {
            target = Array.from(io.sockets.sockets.values()).find((socket) => socket.data.user.id === guestId)
            if (!target) await new Promise((resolve) => setTimeout(resolve, 50))
        }
        assert.ok(target, "The guest's socket reconnects before an incoming call is injected")
        target.emit("call:incomingCall", { from: "mira", roomId: `40:${guestId}`, expiresAt: Date.now() + 60000 })
        await page.getByRole("dialog", { name: "Входящий звонок" }).waitFor()
        await screenshot(page, "incoming-call", width)
        await go(page, "Принять")
        await page.getByRole("group", { name: "Управление звонком" }).waitFor()
        const screenShare = page.getByRole("button", { name: "Демонстрация экрана", exact: true })
        assert.equal(await screenShare.isDisabled(), true, "Starting screen sharing is disabled in the browser")
        assert.match(await screenShare.getAttribute("aria-description"), /доступна в приложении PlayTime/)
        await screenshot(page, "active-call", width)
        await go(page, "Все диалоги")
        await page.waitForTimeout(500)
        await page.getByRole("complementary", { name: "Список чатов" }).waitFor()
        assert.equal(
            await page.getByRole("button", { name: "Все диалоги", exact: true }).count(),
            0,
            "Back to list does not reselect the active call's chat"
        )
        assert.equal(await page.getByRole("group", { name: "Управление звонком" }).isVisible(), true)
        const hangup = await page.getByRole("button", { name: "Завершить звонок", exact: true }).boundingBox()
        assert.ok(
            hangup && hangup.x >= 0 && hangup.x + hangup.width <= width && hangup.y + hangup.height <= height,
            "Hangup remains in the viewport while browsing the chat list"
        )
        await screenshot(page, "active-call-chat-list", width)
        await go(page, "Завершить звонок")
        await page.getByRole("group", { name: "Управление звонком" }).waitFor({ state: "hidden" })
    }
    await go(page, "Друзья")
    await page.getByRole("heading", { name: "Друзья", exact: true }).waitFor()
    await page.getByText("mira", { exact: true }).waitFor()
    await screenshot(page, "friends", width)
    if (width < 700) {
        await page.getByRole("button", { name: "Написать", exact: true }).last().scrollIntoViewIfNeeded()
        await screenshot(page, "friends-bottom", width)
    }
    await go(page, "Профиль")
    await page.getByRole("tab", { name: "Профиль", exact: true }).waitFor()
    await page.getByText(username, { exact: true }).first().waitFor()
    await screenshot(page, "profile", width)
    await page.getByRole("tab", { name: "Аккаунт", exact: true }).click()
    await screenshot(page, "guest-account", width)
    await go(page, "Создать комнату")
    await page.getByRole("heading", { name: "Создать комнату" }).waitFor()
    await screenshot(page, "create-room", width)
    await page.getByLabel("Название комнаты").fill("Вечерний чат")
    await page.getByRole("button", { name: "Создать комнату", exact: true }).last().click()
    await page.getByPlaceholder("Сообщение…").waitFor()
    await page.getByPlaceholder("Сообщение…").fill("Комната готова, встречаемся вечером!")
    await page.getByPlaceholder("Сообщение…").press("Enter")
    await message(page, "Комната готова, встречаемся вечером!").waitFor()
    await screenshot(page, "room-chat", width)
    if (width < 700) await go(page, "Все диалоги")
    await page.getByRole("complementary", { name: "Список чатов" }).getByText("mira", { exact: true }).click()
    await message(page, "Привет! Проверим, как работает веб-версия?").waitFor()
    await page.getByPlaceholder("Сообщение…").fill("Да! Всё на месте, продолжаем общаться в браузере.")
    await page.getByPlaceholder("Сообщение…").press("Enter")
    await message(page, "Да! Всё на месте, продолжаем общаться в браузере.").waitFor()
    const composer = await page.getByPlaceholder("Сообщение…").boundingBox()
    assert.ok(
        composer && composer.width >= 180 && composer.x + composer.width <= width,
        "The message field remains readable and fully visible"
    )
    await screenshot(page, "direct-chat", width)
    await go(page, "Зарегистрировать аккаунт")
    await page.getByRole("heading", { name: "Сохраните свой аккаунт" }).waitFor()
    await screenshot(page, "upgrade", width)
    await page.getByLabel("Почта", { exact: true }).fill(`${username}@typo.test`)
    await page.getByLabel("Пароль", { exact: true }).fill(password)
    await page.getByLabel("Повторите пароль", { exact: true }).fill(password)
    await acceptTerms(page)
    await go(page, "Зарегистрировать аккаунт")
    await page.getByRole("heading", { name: "Подтвердите почту" }).waitFor()
    await screenshot(page, "upgrade-verification", width)
    await go(page, "Изменить почту")
    await page.getByRole("heading", { name: "Изменить почту" }).waitFor()
    await page.getByLabel("Новая почта", { exact: true }).fill(email)
    await page.getByLabel("Пароль аккаунта", { exact: true }).fill("wrong-password")
    await go(page, "Изменить почту")
    await page.getByRole("alert").waitFor()
    await screenshot(page, "change-email-error", width)
    assert.equal(users.get(username).email, `${username}@typo.test`)
    await page.getByLabel("Пароль аккаунта", { exact: true }).fill(password)
    await go(page, "Изменить почту")
    await page.getByRole("heading", { name: "Подтвердите почту" }).waitFor()
    assert.equal(await page.getByLabel("Почта аккаунта", { exact: true }).inputValue(), email)
    assert.equal(users.get(username).id, guestId)
    await screenshot(page, "change-email-verification", width)
    await verifyEmail(page)
    await screenshot(page, "upgrade-complete", width)
    assert.equal(users.get(username).id, guestId)
    assert.equal(users.get(username).isGuest, false)
    await go(page, "Вернуться к общению")
    await page.getByRole("button", { name: "Профиль", exact: true }).waitFor()
    assert.equal(await page.getByRole("button", { name: "Зарегистрировать аккаунт", exact: true }).count(), 0)
    await go(page, "Профиль")
    await page.getByRole("tab", { name: "Аккаунт", exact: true }).click()
    await page.getByRole("heading", { name: "Ваши устройства" }).waitFor()
    await screenshot(page, "registered-account", width)
    if (width === 1440) {
        const backupPassword = "isolated-backup-password-2026"
        await go(page, "Сохранить")
        await page.getByRole("dialog", { name: "Сохранить резервную копию" }).waitFor()
        await page.getByLabel("Пароль резервной копии", { exact: true }).fill(backupPassword)
        await screenshot(page, "key-backup-form", width)
        const downloadPending = page.waitForEvent("download")
        await go(page, "Сохранить копию")
        const download = await downloadPending
        assert.equal(download.suggestedFilename(), `playtime-keys-${guestId}.json`)
        assert.equal(await download.failure(), null)
        const buffer = await fs.readFile(await download.path())
        const source = buffer.toString("utf8"),
            backup = JSON.parse(source)
        assert.deepEqual(Object.keys(backup).sort(), ["ciphertext", "format", "iv", "salt"])
        assert.equal(backup.format, "playtime-key-backup-v1")
        const salt = Buffer.from(backup.salt, "base64"),
            iv = Buffer.from(backup.iv, "base64"),
            ciphertext = Buffer.from(backup.ciphertext, "base64")
        assert.equal(salt.length, 16)
        assert.equal(iv.length, 12)
        const decipher = createDecipheriv("aes-256-gcm", pbkdf2Sync(backupPassword, salt, 600000, 32, "sha256"), iv)
        decipher.setAuthTag(ciphertext.subarray(-16))
        const contents = JSON.parse(
            Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString("utf8")
        )
        assert.equal(contents.userId, guestId)
        assert.ok(contents.keys.dm && Object.keys(contents.keys).some((name) => name.startsWith("room:")))
        assert.equal(
            Buffer.from(nacl.box.keyPair.fromSecretKey(Buffer.from(contents.keys.dm, "base64")).publicKey).toString(
                "base64"
            ),
            users.get(username).publicKey
        )
        for (const value of [backupPassword, username, email, ...Object.values(contents.keys)])
            assert.equal(
                source.includes(value),
                false,
                "The downloaded backup contains no plaintext credentials or encryption keys"
            )
        await page.getByRole("status").filter({ hasText: "Копия сохранена" }).waitFor()
        await screenshot(page, "key-backup-saved", width)
        await go(page, "Готово")
        await go(page, "Восстановить")
        const restore = page.getByRole("dialog", { name: "Восстановить из копии" })
        await restore
            .locator('input[type="file"]')
            .setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer })
        await page.getByLabel("Пароль от копии", { exact: true }).fill(backupPassword)
        await screenshot(page, "key-restore-form", width)
        await restore.getByRole("button", { name: "Восстановить", exact: true }).click()
        await page.getByRole("status").filter({ hasText: "Ключи восстановлены" }).waitFor()
        await screenshot(page, "key-restore-complete", width)
        await go(page, "Готово")
        backupChecks.push({
            filename: download.suggestedFilename(),
            format: backup.format,
            bytes: buffer.length,
            keyCount: Object.keys(contents.keys).length,
            encrypted: true,
            restored: true
        })
    }
    await go(page, "Выйти из аккаунта")
    await go(page, "Войти в аккаунт")
    await page.getByRole("heading", { name: "Вход в аккаунт" }).waitFor()
    await screenshot(page, "login", width)
    await go(page, "Забыли пароль?")
    await screenshot(page, "recovery", width)
    await page.getByLabel("Почта аккаунта", { exact: true }).fill(email)
    await go(page, "Отправить код")
    await page.getByLabel("Код из письма · 6 цифр").fill(code)
    await page.getByLabel("Новый пароль · от 12 до 50 символов").fill(password)
    await page.getByLabel("Повторите новый пароль").fill(password)
    await screenshot(page, "recovery-code", width)
    await go(page, "Изменить пароль")
    await page.getByText("Пароль изменён. Войдите с новым паролем.").waitFor()
    await go(page, "Вернуться ко входу")
    await page.getByLabel("Почта", { exact: true }).fill(email)
    await page.getByLabel("Пароль", { exact: true }).fill(password)
    await go(page, "Войти")
    await page.getByRole("button", { name: "Профиль", exact: true }).waitFor()
    assert.equal(await page.getByRole("button", { name: "Зарегистрировать аккаунт", exact: true }).count(), 0)
    await page.getByRole("complementary", { name: "Список чатов" }).getByText("mira", { exact: true }).click()
    await message(page, "Да! Всё на месте, продолжаем общаться в браузере.").waitFor()
    await screenshot(page, "returning-chat", width)
    let sibling
    if (width === 1440) {
        sibling = await context.newPage()
        sibling.on("pageerror", (error) => errors.push({ width, message: error.message }))
        await sibling.goto(`${base}#/content`)
        await sibling.getByRole("button", { name: "Профиль", exact: true }).waitFor()
        await sibling.getByRole("complementary", { name: "Список чатов" }).getByText("mira", { exact: true }).waitFor()
        const initialToken = await page.evaluate(() => localStorage.getItem("token"))
        const refreshBefore = requests.filter((request) => request.path === "/playtime/auth/refresh").length
        const connected = Array.from(io.sockets.sockets.values()).filter((socket) => socket.data.user.id === guestId)
        assert.equal(connected.length, 2)
        connected.forEach((socket) => socket.emit("session:expired"))
        await Promise.all(
            [page, sibling].map((tab) =>
                tab.waitForFunction((previous) => localStorage.getItem("token") !== previous, initialToken)
            )
        )
        await page.waitForTimeout(1900)
        assert.equal(
            requests.filter((request) => request.path === "/playtime/auth/refresh").length - refreshBefore,
            1,
            "Two tabs share one refresh rotation"
        )
        await message(page, "Да! Всё на месте, продолжаем общаться в браузере.").waitFor()
        assert.equal(await sibling.getByRole("button", { name: "Профиль", exact: true }).isVisible(), true)
        tabChecks.push("concurrent-refresh-single-rotation")
        if (process.env.WEB_APP_REFRESH_TRACE === "1") {
            for (const tab of [page, sibling])
                refreshTrace.push(...(await tab.evaluate(() => window.__refreshTrace || [])))
        }
    }
    await go(page, "Выйти из аккаунта")
    if (sibling) {
        await sibling.getByRole("button", { name: /Войти по нику/ }).waitFor()
        assert.equal(await sibling.evaluate(() => localStorage.getItem("token")), null)
        tabChecks.push("logout-propagates-to-second-tab")
        await sibling.close()
    }
    await page.getByRole("button", { name: /Создать аккаунт/ }).click()
    await page.getByRole("heading", { name: "Создать аккаунт" }).waitFor()
    await screenshot(page, "registration", width)
    await page.getByLabel("Никнейм", { exact: true }).fill(`member${width}`)
    await page.getByLabel("Почта", { exact: true }).fill(`member${width}@example.test`)
    await page.getByLabel("Пароль", { exact: true }).fill(password)
    await page.getByLabel("Повторите пароль", { exact: true }).fill(password)
    await acceptTerms(page)
    await go(page, "Зарегистрироваться")
    await page.getByRole("heading", { name: "Подтвердите почту" }).waitFor()
    await verifyEmail(page)
    await screenshot(page, "registration-complete", width)
    await go(page, "Перейти ко входу")
    await page.getByLabel("Почта", { exact: true }).fill(`member${width}@example.test`)
    await page.getByLabel("Пароль", { exact: true }).fill(password)
    await go(page, "Войти")
    await page.getByRole("button", { name: "Профиль", exact: true }).waitFor()
    await screenshot(page, "new-account-empty", width)
    await context.close()
}

async function checkAuthFailures(base) {
    console.log("Checking committed replies lost in transit and bounded auth waits")
    const profileDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-auth-restart-"))
    temporaryProfiles.push(profileDirectory)
    let offlineLogout = false,
        droppedRevokeRequests = 0
    const openContext = async () => {
        const context = await browserType.launchPersistentContext(profileDirectory, {
            ...browserOptions(),
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
            serviceWorkers: "block"
        })
        persistentContexts.add(context)
        context.on("page", (tab) => {
            tab.on("pageerror", (error) => errors.push({ scenario: "auth-failures", message: error.message }))
            tab.on("console", (message) => {
                if (message.type() === "error")
                    consoleErrors.push({
                        scenario: "auth-failures",
                        expectedOfflineLogout: offlineLogout,
                        message: message.text()
                    })
            })
            tab.on("response", (response) => recordHttpError(response, { scenario: "auth-failures" }))
        })
        await context.route("**/*", (route) => {
            const url = new URL(route.request().url())
            if (offlineLogout && url.pathname === "/playtime/auth/revoke") {
                droppedRevokeRequests++
                return route.abort()
            }
            if (url.origin === new URL(base).origin || ["data:", "blob:"].includes(url.protocol))
                return route.continue()
            external.push(url.origin)
            return route.abort()
        })
        return context
    }
    let context = await openContext(),
        page = await context.newPage()
    currentPage = page
    page.setDefaultTimeout(20000)
    await page.goto(base)
    await page.getByRole("button", { name: /Войти по нику/ }).click()
    await page.getByLabel("Никнейм", { exact: true }).fill("retryguest")
    responseFaults.set("guest:retryguest", true)
    const guestStarted = Date.now()
    await go(page, "Начать общение")
    await page.getByRole("alert").filter({ hasText: "Сервер не ответил вовремя" }).waitFor()
    const guestElapsedMs = Date.now() - guestStarted
    assert.ok(
        guestElapsedMs >= 11000 && guestElapsedMs < 18000,
        "A stalled JSON body releases the guest form at its deadline"
    )
    assert.equal(await page.getByRole("button", { name: "Начать общение", exact: true }).isEnabled(), true)
    const account = users.get("retryguest"),
        issuedGuest = guestClaims.get("retryguest").response
    assert.equal(account.rotation, 1)
    const proof = await page.evaluate(() => JSON.parse(localStorage.getItem("playtime:pending-guest")))
    assert.match(proof.requestKey, /^[a-f0-9]{64}$/)
    await screenshot(page, "guest-response-timeout", 1440)
    await context.close()
    persistentContexts.delete(context)
    context = await openContext()
    page = await context.newPage()
    currentPage = page
    page.setDefaultTimeout(20000)
    await page.goto(base)
    await page.getByRole("heading", { name: "Как вас называть?" }).waitFor()
    assert.equal(await page.getByLabel("Никнейм", { exact: true }).inputValue(), "retryguest")
    await go(page, "Начать общение")
    await page.getByRole("button", { name: "Профиль", exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem("token")), issuedGuest.token)
    assert.equal(await page.evaluate(() => localStorage.getItem("playtime:pending-guest")), null)
    assert.equal(account.rotation, 1, "Retry returns the original guest session rather than reserving another nickname")
    await screenshot(page, "guest-response-recovered", 1440)
    failureChecks.push({
        scenario: "committed-guest-response-lost",
        elapsedMs: guestElapsedMs,
        sameAccount: true,
        sameSession: true,
        survivedBrowserRestart: true
    })

    const saved = await page.evaluate(() => ({
        token: localStorage.getItem("token"),
        refreshToken: localStorage.getItem("refreshToken")
    }))
    tokens.delete(saved.token)
    responseFaults.set(`refresh:${account.id}`, true)
    const refreshStarted = Date.now()
    await page.reload()
    await page.getByRole("button", { name: "Повторить подключение", exact: true }).waitFor()
    const refreshElapsedMs = Date.now() - refreshStarted
    assert.ok(
        refreshElapsedMs >= 11000 && refreshElapsedMs < 19000,
        "A stalled refresh body reaches a retryable screen"
    )
    assert.deepEqual(
        await page.evaluate(() => ({
            token: localStorage.getItem("token"),
            refreshToken: localStorage.getItem("refreshToken")
        })),
        saved
    )
    assert.equal(account.rotation, 2)
    await screenshot(page, "refresh-response-timeout", 1440)
    await context.close()
    persistentContexts.delete(context)
    context = await openContext()
    page = await context.newPage()
    currentPage = page
    page.setDefaultTimeout(20000)
    await page.goto(base)
    await page.getByRole("button", { name: "Профиль", exact: true }).waitFor()
    assert.equal(
        await page.evaluate(() => localStorage.getItem("token")),
        refreshReplays.get(saved.refreshToken).response.token
    )
    assert.equal(account.rotation, 2, "The durable retry proof replays the committed refresh without another rotation")
    assert.ok(refreshRequests.some((request) => request.replay && request.valid && request.hasProof))
    await screenshot(page, "refresh-response-recovered", 1440)
    failureChecks.push({
        scenario: "committed-refresh-response-lost",
        elapsedMs: refreshElapsedMs,
        credentialsPreserved: true,
        replayedSameRotation: true,
        survivedBrowserRestart: true
    })

    const holder = await context.newPage()
    await holder.goto(base)
    await holder.getByRole("button", { name: "Профиль", exact: true }).waitFor()
    await holder.evaluate(() => {
        window.__lockAcquired = false
        void navigator.locks.request("playtime:auth-refresh", async () => {
            window.__lockAcquired = true
            await new Promise((resolve) => {
                window.__releaseAuthLock = resolve
            })
        })
    })
    await holder.waitForFunction(() => window.__lockAcquired)
    const active = await page.evaluate(() => ({
        token: localStorage.getItem("token"),
        refreshToken: localStorage.getItem("refreshToken")
    }))
    tokens.delete(active.token)
    const requestsBeforeLock = refreshRequests.length,
        lockStarted = Date.now()
    await page.reload()
    await page.getByRole("button", { name: "Повторить подключение", exact: true }).waitFor()
    const lockElapsedMs = Date.now() - lockStarted
    assert.ok(
        lockElapsedMs >= 4500 && lockElapsedMs < 10000,
        "Waiting for another tab's lock is bounded independently of the HTTP deadline"
    )
    assert.equal(refreshRequests.length, requestsBeforeLock)
    assert.deepEqual(
        await page.evaluate(() => ({
            token: localStorage.getItem("token"),
            refreshToken: localStorage.getItem("refreshToken")
        })),
        active
    )
    await screenshot(page, "refresh-lock-timeout", 1440)
    await holder.evaluate(() => window.__releaseAuthLock())
    await go(page, "Повторить подключение")
    await page.getByRole("button", { name: "Профиль", exact: true }).waitFor()
    await screenshot(page, "refresh-lock-recovered", 1440)
    assert.equal(account.rotation, 3)
    failureChecks.push({
        scenario: "other-tab-holds-auth-lock",
        elapsedMs: lockElapsedMs,
        credentialsPreserved: true,
        retrySucceeded: true
    })
    await holder.close()
    offlineLogout = true
    await go(page, "Выйти из аккаунта")
    await go(page, "Выйти без регистрации")
    await page.getByRole("button", { name: /Войти по нику/ }).waitFor()
    await page.waitForTimeout(350)
    assert.ok(droppedRevokeRequests > 0, "The logout's server revocation really failed")
    assert.equal(await page.evaluate(() => localStorage.getItem("token")), null)
    await context.close()
    persistentContexts.delete(context)
    offlineLogout = false
    context = await openContext()
    page = await context.newPage()
    currentPage = page
    page.setDefaultTimeout(20000)
    await page.goto(base)
    await page.getByRole("button", { name: /Войти по нику/ }).click()
    await page.getByLabel("Никнейм", { exact: true }).fill("retryguest")
    await go(page, "Начать общение")
    await page.getByRole("alert").filter({ hasText: "Этот никнейм уже занят" }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem("token")), null)
    assert.equal(account.rotation, 3)
    await screenshot(page, "guest-offline-logout-retired", 1440)
    failureChecks.push({
        scenario: "offline-logout-retires-guest-proof",
        serverRevokeFailed: true,
        survivedBrowserRestart: true,
        oldAccountNotReopened: true
    })
    await context.close()
    persistentContexts.delete(context)
}

;(async () => {
    await fs.mkdir(output, { recursive: true })
    const base = await fixture()
    browser = await browserType.launch(browserOptions())
    for (const width of widths) await checkWidth(base, width, width >= 1400 ? 1000 : width >= 1000 ? 900 : 844)
    if (widths.includes(1440) && process.env.WEB_APP_AUTH_FAILURES !== "0") await checkAuthFailures(base)
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    assert.deepEqual(Array.from(unknownEvents), [])
    assert.deepEqual(unknownHttp, [])
    assert.equal(
        httpErrors.filter((response) => response.scenario !== "auth-failures" && !response.expectedRetiredTransport)
            .length,
        widths.length + widths.filter((width) => width !== 320).length
    )
    assert.ok(
        httpErrors.every(
            (response) =>
                (response.path === "/playtime/auth/guest" && response.status === 409) ||
                (response.path === "/playtime/auth/guest/change-email" && response.status === 401) ||
                (response.scenario === "auth-failures" &&
                    response.path === "/playtime/auth/tokenValid" &&
                    response.status === 401) ||
                response.expectedRetiredTransport
        ),
        "Only deliberately tested error responses are allowed"
    )
    const retiredTransportResponses = httpErrors.filter((response) => response.expectedRetiredTransport).length
    const retiredTransportConsole = consoleErrors.filter((error) =>
        /^Failed to load resource: the server responded with a status of 400 /.test(error.message)
    )
    assert.ok(retiredTransportConsole.length <= retiredTransportResponses)
    const unexpectedConsoleErrors = consoleErrors.filter(
        (error) =>
            !/^Failed to load resource: the server responded with a status of (401|409) /.test(error.message) &&
            !(error.expectedOfflineLogout && /Failed to load resource|NetworkError|Load failed/.test(error.message)) &&
            !(retiredTransportResponses > 0 && retiredTransportConsole.includes(error))
    )
    assert.deepEqual(unexpectedConsoleErrors, [])
    assert.equal(sentMessages.length, widths.filter((width) => width !== 320).length * 2)
    await fs.rm(path.join(output, "failure.png"), { force: true })
    await fs.rm(path.join(output, "failure-report.json"), { force: true })
    const screenshotCount = (await fs.readdir(output)).filter((file) => file.endsWith(".png")).length
    const report = {
        generatedAt: new Date().toISOString(),
        mode: useBuild ? "production-build" : "vite-development",
        browser: browser.version(),
        device: process.env.WEB_APP_DEVICE || null,
        widths,
        screenshots: output,
        screenshotCount,
        requests: requests.length,
        socketEvents: Array.from(socketEvents),
        sentMessages,
        backupChecks,
        failureChecks,
        errors,
        consoleErrors,
        unexpectedConsoleErrors,
        httpErrors,
        external,
        localEmojiFixtures: localEmojiFixtures.length,
        layoutIssues,
        unknownHttp,
        tabChecks,
        refreshRequests,
        ...(refreshTrace.length ? { refreshTrace } : {})
    }
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    assert.deepEqual(layoutIssues, [])
})()
    .catch(async (error) => {
        console.error(error)
        console.error("Socket events:", Array.from(socketEvents), "Unknown:", Array.from(unknownEvents))
        console.error("Refresh requests:", refreshRequests)
        console.error("HTTP errors:", httpErrors)
        console.error("Console errors:", consoleErrors)
        console.error("Transport errors:", Array.from(transportErrors.values()))
        await fs
            .writeFile(
                path.join(output, "failure-report.json"),
                JSON.stringify(
                    {
                        error: error.message,
                        httpErrors,
                        consoleErrors,
                        errors,
                        external,
                        unknownHttp,
                        failureChecks,
                        refreshRequests
                    },
                    null,
                    2
                )
            )
            .catch(() => {})
        if (process.env.WEB_APP_REFRESH_TRACE === "1" && currentPage && !currentPage.isClosed()) {
            for (const tab of currentPage.context().pages())
                refreshTrace.push(...(await tab.evaluate(() => window.__refreshTrace || []).catch(() => [])))
            console.error(
                "Refresh trace:",
                refreshTrace.sort((first, second) => first.at - second.at)
            )
        }
        if (currentPage && !currentPage.isClosed()) {
            console.error((await currentPage.locator("body").innerText()).slice(0, 3500))
            await currentPage.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {})
        }
        process.exitCode = 1
    })
    .finally(async () => {
        for (const context of persistentContexts) await context.close().catch(() => {})
        for (const directory of temporaryProfiles) await fs.rm(directory, { recursive: true, force: true })
        await browser?.close()
        await vite?.close()
        if (io) await new Promise((resolve) => io.close(resolve))
        else if (server) {
            server.closeAllConnections()
            await new Promise((resolve) => server.close(resolve))
        }
    })
