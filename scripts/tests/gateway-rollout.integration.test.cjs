const assert = require("node:assert/strict")
const { randomBytes, randomUUID } = require("node:crypto")
const { once } = require("node:events")
const { createRequire } = require("node:module")
const path = require("node:path")
const { setTimeout: delay } = require("node:timers/promises")
const { test } = require("node:test")
const { io } = require("socket.io-client")
const nacl = require("tweetnacl")
const { startAutomaticSelection, startRolloutEdge, slotReady } = require("../fixtures/gateway-rollout-edge.cjs")
const { verifyGatewayAudio } = require("../fixtures/services-gateway-audio.cjs")
const { startInfrastructure, waitUntil } = require("../fixtures/services-gateway-stack.cjs")

const backendRequire = createRequire(path.resolve(__dirname, "../../apps/package.json"))

async function login(url, email, password) {
    const response = await fetch(`${url}/playtime/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(5000)
    })
    const body = await response.json()
    assert.equal(response.status, 200, body.error)
    return body
}

function event(target, name, timeout = 10000) {
    const pending = once(target, name, { signal: AbortSignal.timeout(timeout) }).then(
        ([payload]) => payload,
        (error) => {
            throw new Error(`Waiting for ${name} failed`, { cause: error })
        }
    )
    pending.catch(() => {})
    return pending
}

async function ack(socket, name, ...args) {
    const response = await socket.timeout(5000).emitWithAck(name, ...args)
    assert.ok(!response?.err, response?.err)
    return response
}

async function openSocket(fixture, url, token, transport) {
    const socket = io(url, {
        path: "/playtime/socket.io",
        transports: [transport],
        autoConnect: false,
        reconnection: true,
        reconnectionDelay: transport === "polling" ? 2000 : 1000,
        randomizationFactor: 0,
        forceNew: true,
        auth: { token, callProtocol: 3, callEndpointId: randomUUID(), peerIdentityProtocol: 1 }
    })
    fixture.sockets.push(socket)
    const connected = event(socket, "connect")
    socket.connect()
    await connected
    return socket
}

async function checkReady(gateway) {
    return waitUntil(async () => {
        const response = await fetch(`${gateway.url}/readyz`, { signal: AbortSignal.timeout(1000) })
        await response.body?.cancel()
        return response.ok && response.headers.get("x-playtime-gateway-slot") === gateway.slot
    }, `${gateway.slot} gateway readiness`)
}

async function probeHttp(url, token) {
    const { status, slot } = await sampleHttp(url, token)
    assert.equal(status, 200, "Authenticated HTTP across the rollout")
    return slot
}

async function sampleHttp(url, token) {
    const response = await fetch(`${url}/playtime/subscription/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000)
    }).catch(() => null)
    const slot = response?.headers.get("x-test-gateway-slot") ?? null
    if (!response) return { status: 0, slot }
    if (response.ok) {
        const body = await response.json().catch(() => null)
        if (!body) return { status: 0, slot }
        assert.equal(typeof body.planSlug, "string")
    } else await response.body?.cancel()
    return { status: response.status, slot }
}

async function observe(probe, operation, interval = 100) {
    const samples = [{ at: Date.now(), value: await probe() }]
    let active = true
    const monitor = (async () => {
        while (active) {
            await delay(interval)
            samples.push({ at: Date.now(), value: await probe() })
        }
    })()
    monitor.catch(() => {})
    try {
        await operation()
    } finally {
        active = false
        await monitor
    }
    return samples
}

function verifyRtp(samples) {
    const first = samples[0],
        last = samples.at(-1)
    for (const index of [0, 1]) {
        let at = first.at,
            packets = first.value[index].packets
        for (const sample of samples.slice(1)) {
            assert.ok(sample.at - at < 1800, `Peer ${index} stopped receiving RTP during gateway transition`)
            if (sample.value[index].packets <= packets) continue
            at = sample.at
            packets = sample.value[index].packets
        }
        assert.ok(last.value[index].packets - first.value[index].packets >= 10, `Peer ${index} received too little RTP`)
        assert.ok(last.value[index].bytes > first.value[index].bytes, `Peer ${index} did not receive RTP bytes`)
    }
}

async function prepareGatewayCall(t, { splitConnections = true, isolateSecondaryRelay, dualDomains, dualAuth } = {}) {
    const fixture = await startInfrastructure(t, { dualGateway: true, isolateSecondaryRelay, dualDomains, dualAuth })
    const [primary, secondary] = fixture.gateways
    await Promise.all([checkReady(primary), checkReady(secondary)])
    const edge = await startRolloutEdge(t, fixture.gateways)
    const password = randomBytes(16).toString("hex")
    const hash = await backendRequire("bcrypt").hash(password, 10)
    const {
        rows: [first, second]
    } = await fixture.pool.query(
        "INSERT INTO users(username,email,password_hash,email_verified_at) VALUES ($1,$2,$5,NOW()),($3,$4,$5,NOW()) RETURNING id,email",
        ["RolloutAlice", "rollout-alice@example.test", "RolloutBob", "rollout-bob@example.test", hash]
    )
    await fixture.pool.query("INSERT INTO friendships(user_id,friend_id,status) VALUES ($1,$2,'accepted')", [
        first.id,
        second.id
    ])
    const alice = await login(edge.url, first.email, password)
    const left = await openSocket(fixture, edge.url, alice.token, "websocket")
    assert.match(left.io.engine.id, /^p_/)
    if (splitConnections) edge.activate(secondary.slot)
    const bob = await login(edge.url, second.email, password)
    const right = await openSocket(fixture, edge.url, bob.token, "polling")
    assert.match(right.io.engine.id, splitConnections ? /^s_/ : /^p_/)
    const sockets = [left, right]
    const users = [alice.user.id, bob.user.id]
    await waitUntil(async () => {
        const visible = await Promise.all(sockets.map((socket) => ack(socket, "presence:listByUserId")))
        return visible[0].includes(users[1]) && visible[1].includes(users[0])
    }, "friend presence across both gateways")

    const incoming = event(right, "call:incomingCall")
    const call = await ack(left, "call:start", { peerUserId: bob.user.id })
    assert.equal(call.success, true)
    assert.equal((await incoming).roomId, call.roomId)
    const confirmed = event(left, "call:confirmed")
    assert.equal((await ack(right, "call:confirm", { roomId: call.roomId, accept: true })).success, true)
    assert.equal((await confirmed).roomId, call.roomId)
    const calls = await Promise.all(sockets.map((socket) => ack(socket, "call:current")))
    const revisions = calls.map(({ state }) => {
        assert.equal(state.status, "in_call")
        assert.ok(state.media.active)
        return state.media.ownershipRevision
    })
    const ice = await Promise.all(
        sockets.map(async (socket) => {
            const pending = event(socket, "webrtc:config")
            socket.emit("webrtc:config:request")
            const { iceServers } = await pending
            const turn = iceServers.find(({ urls }) => urls === fixture.turnUrl)
            assert.ok(turn)
            return [turn]
        })
    )
    const exchangeSignal = async (sender, description) => {
        const receiver = 1 - sender
        const pending = event(sockets[receiver], "webrtc:signal")
        sockets[sender].emit("webrtc:signal", {
            roomId: call.roomId,
            context: "direct",
            type: description.type,
            targetUserId: users[receiver],
            ownershipRevision: revisions[sender],
            targetOwnershipRevision: revisions[receiver],
            payload: description
        })
        const signal = await pending
        assert.equal(signal.roomId, call.roomId)
        assert.equal(signal.fromUserId, users[sender])
        assert.deepEqual(signal.payload, description)
        return signal.payload
    }

    return {
        fixture,
        edge,
        primary,
        secondary,
        left,
        right,
        sockets,
        users,
        alice,
        bob,
        call,
        revisions,
        ice,
        exchangeSignal
    }
}

async function requireDomainReplicas(gateways) {
    await waitUntil(async () => {
        const checks = await Promise.all(
            gateways.map(({ url }) => fetch(`${url}/readyz`, { signal: AbortSignal.timeout(1000) }))
        )
        for (const response of checks) await response.body?.cancel()
        return checks.every((response) => response.ok && response.headers.get("x-playtime-domain-replicas") === "2,2")
    }, "two ready replicas of Chat and Room on both gateways")
}

async function restartDomains(fixture) {
    for (const [name, router] of [
        ["chat-api", fixture.chatRouter],
        ["room-api", fixture.roomRouter]
    ]) {
        for (const [target, serving] of [
            [`${name}-secondary`, "primary"],
            [name, "secondary"]
        ]) {
            router.selectHttp(serving)
            await fixture.stopApp(target)
            await fixture.startApp(target)
            await requireDomainReplicas(fixture.gateways)
        }
    }
}

test(
    "rolling every Auth, Chat and Room pod keeps messages and a direct TURN call live",
    { timeout: 120000 },
    async (t) => {
        const { fixture, edge, sockets, alice, bob, call, revisions, ice, exchangeSignal } = await prepareGatewayCall(
            t,
            { dualDomains: true, dualAuth: true }
        )
        await requireDomainReplicas(fixture.gateways)
        const engineIds = sockets.map((socket) => socket.io.engine.id)
        const receivedIds = []
        let disconnected = 0
        const keys = sockets.map(() => nacl.box.keyPair())
        const users = [alice.user, bob.user]
        for (const [index, socket] of sockets.entries()) {
            socket.on("disconnect", () => disconnected++)
            socket.on("message:receive", ({ id }) => receivedIds.push(id))
            const publicKey = Buffer.from(keys[index].publicKey).toString("base64")
            assert.equal((await ack(socket, "profile:setDmPublicKey", { publicKey })).success, true)
        }

        let sequence = 0
        async function message() {
            const sender = sequence++ % 2
            const receiver = 1 - sender
            const payload = Buffer.from(`Message during rollout ${sequence}`)
            const nonce = nacl.randomBytes(nacl.box.nonceLength)
            const sealed = nacl.box(payload, nonce, keys[receiver].publicKey, keys[sender].secretKey)
            const content = `E2E1:${JSON.stringify({ n: Buffer.from(nonce).toString("base64"), b: Buffer.from(sealed).toString("base64") })}`
            const pending = event(sockets[receiver], "message:receive")
            const target = users[receiver]
            const command = { peerUserId: target.id, username: target.username, clientMessageId: randomUUID(), content }
            const response = await ack(sockets[sender], "message:send", command)
            const delivered = await pending
            assert.equal(response.success, true)
            assert.equal(delivered.id, response.id)
            assert.equal(delivered.content, content)
            assert.equal((await ack(sockets[sender], "message:send", command)).id, response.id)
            return response.id
        }

        await verifyGatewayAudio(ice, exchangeSignal, async ({ sampleAudio, restartIce }) => {
            const captured = await observe(sampleAudio, async () => {
                const messages = await observe(
                    message,
                    async () => {
                        const probes = await observe(
                            () => probeHttp(edge.url, alice.token),
                            async () => {
                                fixture.authRouter.selectHttp("secondary")
                                fixture.authRouter.selectRelay("secondary")
                                await fixture.stopApp("auth-api")
                                await fixture.startApp("auth-api")
                                fixture.authRouter.selectHttp("primary")
                                fixture.authRouter.selectRelay("primary")
                                await fixture.stopApp("auth-api-secondary")
                                await fixture.startApp("auth-api-secondary")
                                await restartDomains(fixture)
                            }
                        )
                        assert.ok(probes.length >= 15)
                    },
                    70
                )
                const ids = messages.map(({ value }) => value)
                assert.ok(ids.length >= 15)
                assert.deepEqual(receivedIds, ids)
                assert.equal(new Set(ids).size, ids.length)
                const receipts = await fixture.pool.query(
                    "SELECT message_id FROM message_send_receipts WHERE message_id = ANY($1::int[]) ORDER BY message_id",
                    [ids]
                )
                assert.deepEqual(
                    receipts.rows.map(({ message_id }) => message_id),
                    ids
                )
                const history = await fixture.pool.query(
                    "SELECT id FROM messages WHERE id = ANY($1::int[]) ORDER BY id",
                    [ids]
                )
                assert.deepEqual(
                    history.rows.map(({ id }) => id),
                    ids.slice(-40)
                )
                t.diagnostic(`${ids.length} encrypted messages delivered and persisted exactly once`)
            })
            verifyRtp(captured)
            await restartIce()
        })
        assert.equal(disconnected, 0)
        assert.deepEqual(
            sockets.map((socket) => socket.io.engine.id),
            engineIds
        )
        for (const [index, socket] of sockets.entries()) {
            const { state } = await ack(socket, "call:current")
            assert.equal(state.roomId, call.roomId)
            assert.equal(state.media.ownershipRevision, revisions[index])
        }
    }
)

test(
    "rolling Room and Gateway pods preserves active group TURN audio and membership",
    { timeout: 120000 },
    async (t) => {
        const { fixture, edge, sockets, users, call, revisions, ice, primary, secondary } = await prepareGatewayCall(
            t,
            {
                dualDomains: true
            }
        )
        const [left, right] = sockets
        const ended = event(right, "call:ended")
        left.emit("call:end", { roomId: call.roomId, ownershipRevision: revisions[0] })
        await ended
        const { roomId } = await ack(left, "room:create", { name: "Rollout Group" })
        assert.equal((await ack(left, "room:addMember", { roomId, peerUserId: users[1] })).success, true)
        const departure = []
        const membership = new Map()
        for (const socket of sockets) {
            socket.on("party:roomClosed", (payload) => departure.push(payload))
            socket.on("party:participant:left", (payload) => departure.push(payload))
            const join = () => {
                const result = ack(socket, "room:enter", { roomId }).then((value) => assert.equal(value.success, true))
                membership.set(socket, result)
                result.catch(() => {})
                return result
            }
            await join()
            socket.on("connect", join)
        }
        await requireDomainReplicas(fixture.gateways)

        async function partySignal(sender, payload) {
            const receiver = 1 - sender
            const pending = event(sockets[receiver], "webrtc:signal")
            sockets[sender].emit("webrtc:signal", {
                roomId,
                context: "party",
                targetUserId: users[receiver],
                type: payload.type,
                payload
            })
            const signal = await pending
            assert.equal(signal.context, "party")
            assert.equal(signal.roomId, roomId)
            assert.deepEqual(signal.payload, payload)
            return signal.payload
        }

        await verifyGatewayAudio(ice, partySignal, async ({ sampleAudio, restartIce }) => {
            const samples = await observe(sampleAudio, async () => {
                const engineIds = sockets.map((socket) => socket.io.engine.id)
                await restartDomains(fixture)
                assert.deepEqual(
                    sockets.map((socket) => socket.io.engine.id),
                    engineIds
                )
                for (const [retiring, survivor, prefix] of [
                    [primary, secondary, "p_"],
                    [secondary, primary, "s_"]
                ]) {
                    const moving = sockets.filter((socket) => socket.io.engine.id.startsWith(prefix))
                    assert.ok(moving.length > 0)
                    const reconnects = moving.map((socket) => event(socket, "connect"))
                    edge.activate(survivor.slot)
                    await fixture.stopApp(retiring.name)
                    await Promise.all(reconnects)
                    await Promise.all(moving.map((socket) => membership.get(socket)))
                    await fixture.startApp(retiring.name)
                    await requireDomainReplicas(fixture.gateways)
                    assert.deepEqual(departure, [])
                }
            })
            verifyRtp(samples)
            await restartIce()
            await delay(16_000)
            assert.deepEqual(departure, [])
            t.diagnostic(
                "Group RTP continued across Room and Gateway updates, no member was removed during reconnect grace"
            )
        })
    }
)

test("rolling two gateways preserves HTTP, polling affinity and live TURN audio", { timeout: 120000 }, async (t) => {
    const {
        fixture,
        edge,
        primary,
        secondary,
        left,
        right,
        sockets,
        users,
        alice,
        bob,
        call,
        revisions,
        ice,
        exchangeSignal
    } = await prepareGatewayCall(t)

    await verifyGatewayAudio(ice, exchangeSignal, async ({ sampleAudio, restartIce }) => {
        async function migrate(source, target, expectedReconnects) {
            await checkReady(target)
            edge.activate(target.slot)
            const previous = sockets.map((socket) => socket.io.engine.id)
            const startRequest = edge.socketRequests.length
            assert.equal((await ack(right, "get:username")).userId, bob.user.id)
            assert.equal(right.io.engine.id, previous[1], "The existing polling session keeps its gateway")
            assert.ok(
                edge.socketRequests
                    .slice(startRequest)
                    .some(({ sid, slot, method }) => sid === previous[1] && slot === "secondary" && method === "POST")
            )
            const disconnects = expectedReconnects.map((index) => event(sockets[index], "disconnect"))
            const reconnects = expectedReconnects.map((index) => event(sockets[index], "connect"))
            const samples = await observe(sampleAudio, async () => {
                await fixture.stopApp(source.name)
                for (const reason of await Promise.all(disconnects)) {
                    assert.match(reason, /^transport (close|error)$/)
                }
                await Promise.all(reconnects)
                for (const [index, socket] of sockets.entries()) {
                    const engineId = socket.io.engine.id
                    assert.match(engineId, target.slot === "primary" ? /^p_/ : /^s_/)
                    if (expectedReconnects.includes(index)) assert.notEqual(engineId, previous[index])
                    else assert.equal(engineId, previous[index])
                    const { state } = await ack(socket, "call:current")
                    assert.equal(state.roomId, call.roomId)
                    assert.equal(state.media.ownershipRevision, revisions[index])
                    assert.equal(
                        (
                            await ack(socket, "call:resume", {
                                roomId: call.roomId,
                                ownershipRevision: revisions[index]
                            })
                        ).status,
                        "in_call"
                    )
                }
                await delay(350)
            })
            verifyRtp(samples)
            await restartIce()
            t.diagnostic(
                `${source.slot} stopped, both clients use ${target.slot}, RTP still arrives in both directions`
            )
        }
        const http = await observe(
            () => probeHttp(edge.url, alice.token),
            async () => {
                await migrate(primary, secondary, [0])
                await fixture.startApp(primary.name)
                await migrate(secondary, primary, [0, 1])
                await fixture.startApp(secondary.name)
                await checkReady(secondary)
            }
        )
        assert.ok(http.length >= 20)
        assert.ok(http.some(({ value }) => value === "primary"))
        assert.ok(http.some(({ value }) => value === "secondary"))
    })
    const ended = event(right, "call:ended")
    left.emit("call:end", { roomId: call.roomId, ownershipRevision: revisions[0] })
    assert.equal((await ended).roomId, call.roomId)

    const room = await ack(left, "room:create", { name: "Rollout Room" })
    assert.equal(room.success, true)
    assert.equal((await ack(left, "room:addMember", { roomId: room.roomId, peerUserId: users[1] })).success, true)
    for (const socket of sockets) assert.equal((await ack(socket, "room:enter", { roomId: room.roomId })).success, true)
    const departed = event(right, "party:participant:left")
    const reconnected = event(left, "connect")
    edge.activate(secondary.slot)
    left.io.engine.close()
    assert.equal((await departed).userId, users[0])
    await reconnected
    assert.match(left.io.engine.id, /^s_/)
    assert.match(right.io.engine.id, /^p_/)
    const rejoined = event(right, "party:participant:joined")
    assert.equal((await ack(left, "room:enter", { roomId: room.roomId })).success, true)
    assert.equal((await rejoined).userId, users[0])
    const signal = event(right, "webrtc:signal")
    const offer = { type: "offer", sdp: "v=0\r\n" }
    left.emit("webrtc:signal", {
        roomId: room.roomId,
        context: "party",
        type: "offer",
        targetUserId: users[1],
        payload: offer
    })
    assert.deepEqual((await signal).payload, offer)
    t.diagnostic("Group participant rejoined through the other gateway and signaling reached the peer")
})

test(
    "unexpected gateway and Chat relay loss switch new connections while TURN audio continues",
    { timeout: 120000 },
    async (t) => {
        const { fixture, edge, primary, secondary, sockets, alice, call, revisions, ice, exchangeSignal } =
            await prepareGatewayCall(t, { splitConnections: false, isolateSecondaryRelay: "CHAT" })
        await startAutomaticSelection(t, edge, fixture.gateways)
        await waitUntil(
            async () => (await Promise.all(fixture.gateways.map(slotReady))).every(Boolean),
            "HTTP readiness of both slots"
        )

        await verifyGatewayAudio(ice, exchangeSignal, async ({ sampleAudio, restartIce }) => {
            async function exerciseFailure(source, target, inject, oldPollingStatus) {
                assert.equal(edge.active, source.slot)
                const previous = sockets.map((socket) => socket.io.engine.id)
                const disconnects = sockets.map((socket) => event(socket, "disconnect"))
                const reconnects = sockets.map((socket) => event(socket, "connect", 20000))
                let failureAt
                const http = await observe(
                    () => sampleHttp(edge.url, alice.token),
                    async () => {
                        const samples = await observe(sampleAudio, async () => {
                            failureAt = Date.now()
                            await inject()
                            await waitUntil(
                                () => edge.active === target.slot,
                                `automatic change to ${target.slot}`,
                                6000
                            )
                            for (const reason of await Promise.all(disconnects))
                                assert.match(reason, /^transport (close|error)$/)
                            await Promise.all(reconnects)
                            for (const [index, socket] of sockets.entries()) {
                                assert.match(socket.io.engine.id, target.slot === "primary" ? /^p_/ : /^s_/)
                                assert.notEqual(socket.io.engine.id, previous[index])
                                const { state } = await ack(socket, "call:current")
                                assert.equal(state.roomId, call.roomId)
                                assert.equal(state.media.ownershipRevision, revisions[index])
                                assert.equal(
                                    (
                                        await ack(socket, "call:resume", {
                                            roomId: call.roomId,
                                            ownershipRevision: revisions[index]
                                        })
                                    ).status,
                                    "in_call"
                                )
                            }
                            const formerSid = encodeURIComponent(previous[1])
                            const previousPolling = await fetch(
                                `${edge.url}/playtime/socket.io/?EIO=4&transport=polling&sid=${formerSid}`,
                                {
                                    signal: AbortSignal.timeout(2000)
                                }
                            )
                            assert.equal(previousPolling.status, oldPollingStatus)
                            await previousPolling.body?.cancel()
                        })
                        verifyRtp(samples)
                    }
                )
                const recoveredIndex = http.findIndex(({ value }) => value.status === 200 && value.slot === target.slot)
                assert.ok(recoveredIndex > 0, `Authenticated HTTP continued on ${target.slot}`)
                assert.equal(http[0].value.slot, source.slot)
                assert.ok(http[recoveredIndex].at - failureAt < 6000, "Automatic HTTP recovery is bounded")
                assert.ok(
                    http.slice(recoveredIndex).every(({ value }) => value.status === 200 && value.slot === target.slot)
                )
                if (oldPollingStatus === 502) {
                    assert.ok(http.slice(0, recoveredIndex).some(({ value }) => value.status === 502))
                }
                await restartIce()
                t.diagnostic(
                    `${source.slot} → ${target.slot} recovered HTTP in ${http[recoveredIndex].at - failureAt}ms, resumed both sockets and delivered TURN audio`
                )
            }

            await exerciseFailure(
                primary,
                secondary,
                async () => {
                    assert.deepEqual(await fixture.killApp(primary.name), [null, "SIGKILL"])
                },
                502
            )
            await fixture.startApp(primary.name)
            await checkReady(primary)
            assert.equal(
                edge.active,
                secondary.slot,
                "A restarted primary does not immediately displace the active backup"
            )
            await exerciseFailure(
                secondary,
                primary,
                async () => {
                    fixture.secondaryRelay.cut()
                    await waitUntil(
                        async () => !(await slotReady(secondary)),
                        "Chat relay loss reflected by HTTP readiness"
                    )
                    const health = await fetch(`${secondary.url}/playtime/health`, {
                        signal: AbortSignal.timeout(2000)
                    })
                    assert.equal(health.status, 200, "Gateway process stayed up during the relay fault")
                    await health.body?.cancel()
                    const handshake = await fetch(`${secondary.url}/playtime/socket.io/?EIO=4&transport=polling`, {
                        signal: AbortSignal.timeout(2000)
                    })
                    assert.ok([403, 503].includes(handshake.status), "Unready gateway refuses new Engine.IO sessions")
                    await handshake.body?.cancel()
                },
                400
            )
            fixture.secondaryRelay.restore()
            await checkReady(secondary)
            assert.equal(edge.active, primary.slot)
        })
        const ended = event(sockets[1], "call:ended")
        sockets[0].emit("call:end", { roomId: call.roomId, ownershipRevision: revisions[0] })
        assert.equal((await ended).roomId, call.roomId)
    }
)
