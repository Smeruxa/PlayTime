const assert = require("node:assert/strict")
const { randomBytes } = require("node:crypto")
const { once } = require("node:events")
const { createRequire } = require("node:module")
const path = require("node:path")
const { test } = require("node:test")
const { setTimeout: delay } = require("node:timers/promises")
const { io } = require("socket.io-client")
const { startInfrastructure, waitUntil } = require("../fixtures/services-gateway-stack.cjs")

const backendRequire = createRequire(path.resolve(__dirname, "../../apps/package.json"))

async function auth(url, route, body) {
    const response = await fetch(`${url}/playtime/auth/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000)
    })
    return { status: response.status, body: await response.json(), replica: response.headers.get("x-qa-auth-replica") }
}

function connect(fixture, token, reconnection = false) {
    const socket = io(fixture.url, {
        path: "/playtime/socket.io",
        auth: { token },
        transports: ["websocket"],
        autoConnect: false,
        reconnection,
        reconnectionDelay: 150,
        forceNew: true
    })
    fixture.sockets.push(socket)
    return socket
}

async function connectValid(fixture, token) {
    const socket = connect(fixture, token)
    const connected = once(socket, "connect", { signal: AbortSignal.timeout(4000) })
    socket.connect()
    await connected
    return socket
}

test("auth replica can revoke sessions on another replica's gateway relay", { timeout: 65000 }, async (t) => {
    const fixture = await startInfrastructure(t, { dualAuth: true })
    const { url, pool, authRouter } = fixture
    const ready = () => fetch(url + "/readyz").then((response) => response.ok)
    await waitUntil(ready, "gateway AUTH listener readiness")
    const password = randomBytes(18).toString("hex")
    const passwordHash = await backendRequire("bcrypt").hash(password, 10)
    const accounts = [
        { username: "ReplicaAlice", email: "ha-alice@example.test" },
        { username: "ReplicaBob", email: "ha-bob@example.test" }
    ]
    for (const { username, email } of accounts) {
        await pool.query("INSERT INTO users(username,email,password_hash,email_verified_at) VALUES ($1,$2,$3,NOW())", [
            username,
            email,
            passwordHash
        ])
    }
    const [alice, bob] = await Promise.all(accounts.map(({ email }) => auth(url, "login", { email, password })))
    assert.equal(alice.status, 200)
    assert.equal(bob.status, 200)
    assert.equal(alice.replica, "primary")
    assert.equal(bob.replica, "primary")
    const [first, second] = await Promise.all([
        connectValid(fixture, alice.body.token),
        connectValid(fixture, bob.body.token)
    ])
    authRouter.selectHttp("secondary")
    await pool.query("SELECT pg_notify('playtime_auth_session_changes', $1)", [
        JSON.stringify(["user", String(alice.body.user.id)])
    ])
    await delay(350)
    assert.equal(first.connected, true, "Notification alone cannot revoke a valid session")
    assert.equal(second.connected, true)

    const signal = AbortSignal.timeout(5000)
    const revoked = once(first, "session:revoked", { signal })
    const disconnected = once(first, "disconnect", { signal })
    const response = await auth(url, "revoke", { token: alice.body.token, refreshToken: alice.body.refreshToken })
    assert.equal(response.status, 200)
    assert.equal(response.replica, "secondary")
    await revoked
    assert.equal((await disconnected)[0], "io server disconnect")
    assert.equal(second.connected, true, "Revoking Alice leaves Bob connected")

    authRouter.selectRelay("secondary")
    await fixture.stopApp("auth-api")
    assert.equal((await auth(url, "tokenValid", { token: bob.body.token })).status, 200)
    assert.equal(second.connected, true, "Losing one AUTH relay does not close an authorized socket")
    assert.equal((await second.timeout(3000).emitWithAck("get:username")).userId, bob.body.user.id)
    const transportClosed = once(second, "disconnect", { signal: AbortSignal.timeout(5000) })
    const result = await pool.query(
        "SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name = 'playtime-gateway-auth-watch'"
    )
    assert.deepEqual(result.rows, [{ terminated: true }])
    assert.equal((await transportClosed)[0], "transport close")
    await waitUntil(ready, "gateway AUTH listener recovery")
    const restored = await connectValid(fixture, bob.body.token)
    assert.equal((await restored.timeout(3000).emitWithAck("get:username")).userId, bob.body.user.id)

    authRouter.failNextSessionRequest("verify", 503)
    const retrying = connect(fixture, bob.body.token, true)
    const firstRetry = once(retrying.io, "reconnect_attempt", { signal: AbortSignal.timeout(4000) })
    const firstRecovery = once(retrying, "connect", { signal: AbortSignal.timeout(4000) })
    retrying.connect()
    await Promise.all([firstRetry, firstRecovery])

    authRouter.failNextSessionRequest("check", "reset")
    const retryClosed = once(retrying, "disconnect", { signal: AbortSignal.timeout(4000) })
    const secondRecovery = once(retrying, "connect", { signal: AbortSignal.timeout(4000) })
    retrying.emit("get:username")
    assert.equal((await retryClosed)[0], "transport close")
    await secondRecovery
    assert.equal((await retrying.timeout(3000).emitWithAck("get:username")).userId, bob.body.user.id)

    for (const token of [alice.body.token, bob.body.token]) {
        if (token === bob.body.token) authRouter.failNextSessionRequest("verify", 403)
        const rejected = connect(fixture, token, true)
        const error = once(rejected, "connect_error", { signal: AbortSignal.timeout(4000) })
        rejected.connect()
        assert.match((await error)[0].message, /Authentication error/)
        assert.equal(rejected.active, false, "HTTP 401 and 403 must stop automatic reconnect")
    }
})
