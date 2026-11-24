const assert = require("node:assert/strict")
const { randomBytes, randomUUID } = require("node:crypto")
const { once } = require("node:events")
const { createRequire } = require("node:module")
const path = require("node:path")
const { test } = require("node:test")
const { io } = require("socket.io-client")
const nacl = require("tweetnacl")
const { verifyGatewayAudio } = require("../fixtures/services-gateway-audio.cjs")
const { startInfrastructure, waitUntil } = require("../fixtures/services-gateway-stack.cjs")

const backendRequire = createRequire(path.resolve(__dirname, "../../apps/package.json"))

function waitForEvent(socket, event, predicate = () => true) {
    const pending = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off(event, listener)
            reject(new Error(`Timed out waiting for ${event}`))
        }, 8000)
        const listener = (payload) => {
            if (!predicate(payload)) return
            clearTimeout(timeout)
            socket.off(event, listener)
            resolve(payload)
        }
        socket.on(event, listener)
    })
    pending.catch(() => {})
    return pending
}

async function connect(socketList, url, token, transport) {
    const socket = io(url, {
        path: "/playtime/socket.io",
        transports: [transport],
        autoConnect: false,
        reconnection: false,
        forceNew: true,
        timeout: 5000,
        auth: { token, callProtocol: 3, callEndpointId: randomUUID(), peerIdentityProtocol: 1 }
    })
    socketList.push(socket)
    const connected = Promise.race([
        once(socket, "connect"),
        once(socket, "connect_error").then(([error]) => {
            throw error
        })
    ])
    socket.connect()
    await connected
    return socket
}

async function ack(socket, event, ...args) {
    return socket.timeout(8000).emitWithAck(event, ...args)
}

function assertOk(result) {
    assert.equal(result?.success, true, JSON.stringify(result))
    return result
}

async function post(url, route, body, status = 200) {
    const response = await fetch(`${url}/playtime/auth/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
    })
    const data = await response.json()
    assert.equal(response.status, status, data.error)
    return data
}

function toBase64(bytes) {
    return Buffer.from(bytes).toString("base64")
}

function boxEnvelope(plaintext, sender, recipient) {
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const sealed = nacl.box(plaintext, nonce, recipient.publicKey, sender.secretKey)
    return `E2E1:${JSON.stringify({ n: toBase64(nonce), b: toBase64(sealed) })}`
}

function openBox(ciphertext, senderPublicKey, recipient) {
    assert.match(ciphertext, /^E2E1:/)
    const envelope = JSON.parse(ciphertext.slice(5))
    return nacl.box.open(
        Buffer.from(envelope.b, "base64"),
        Buffer.from(envelope.n, "base64"),
        senderPublicKey,
        recipient.secretKey
    )
}

test("gateway serves real login, encrypted chats and a WebRTC call", { timeout: 90000 }, async (t) => {
    const fixture = await startInfrastructure(t)
    const password = randomBytes(16).toString("hex")
    const { url, pool, sockets, turnUrl, adminKey } = fixture
    const hash = await backendRequire("bcrypt").hash(password, 10)
    await pool.query(
        "INSERT INTO users(username,email,password_hash,email_verified_at) VALUES ($1,$2,$5,NOW()),($3,$4,$5,NOW())",
        ["GatewayAlice", "alice@example.test", "GatewayBob", "bob@example.test", hash]
    )
    const [alice, bob, guest] = await Promise.all([
        post(url, "login", { email: "alice@example.test", password }),
        post(url, "login", { email: "bob@example.test", password }),
        post(url, "guest", { username: "GatewayGuest", requestKey: randomBytes(32).toString("hex") })
    ])
    assert.equal((await post(url, "tokenValid", { token: alice.token })).user.id, alice.user.id)
    const [left, right, guestSocket] = await Promise.all([
        connect(sockets, url, alice.token, "websocket"),
        connect(sockets, url, bob.token, "polling"),
        connect(sockets, url, guest.token, "websocket")
    ])
    assert.equal((await ack(guestSocket, "get:username")).userId, guest.user.id)
    t.diagnostic("Verified password login and guest login through gateway HTTP and Socket.IO")

    await t.test("media counters track legacy writes, resize and removal with restricted roles", async () => {
        const connection = await pool.connect()
        const key = randomUUID()
        try {
            await connection.query("BEGIN")
            await connection.query("SET LOCAL ROLE playtime_test_chat")
            const oldInsert =
                "INSERT INTO media_objects(storage_key,user_id,kind,size_bytes,encrypted) VALUES ($1,$2,'voice',100,true)"
            await connection.query(oldInsert, [key, guest.user.id])
            await connection.query(oldInsert + " ON CONFLICT DO NOTHING", [key, guest.user.id])
            const usage = async () =>
                (
                    await connection.query(
                        `SELECT scope, size_bytes::int AS size, voices FROM media_quota_usage
                 WHERE scope IN ('all','guest') OR (scope='user' AND user_id=$1) ORDER BY scope`,
                        [guest.user.id]
                    )
                ).rows
            assert.deepEqual(await usage(), [
                { scope: "all", size: 100, voices: 0 },
                { scope: "guest", size: 100, voices: 0 },
                { scope: "user", size: 100, voices: 1 }
            ])
            await connection.query("UPDATE media_objects SET size_bytes=33,finalized_at=NOW() WHERE storage_key=$1", [
                key
            ])
            assert.deepEqual(await usage(), [
                { scope: "all", size: 33, voices: 0 },
                { scope: "guest", size: 33, voices: 0 },
                { scope: "user", size: 33, voices: 1 }
            ])
            await connection.query("DELETE FROM media_objects WHERE storage_key=$1", [key])
            assert.deepEqual(await usage(), [
                { scope: "all", size: 0, voices: 0 },
                { scope: "guest", size: 0, voices: 0 }
            ])
            await assert.rejects(connection.query("UPDATE media_quota_usage SET size_bytes=0"), { code: "42501" })
        } finally {
            await connection.query("ROLLBACK")
            connection.release()
        }

        const form = new FormData()
        form.append("file", new Blob([Buffer.alloc(64)], { type: "application/octet-stream" }), "encrypted.bin")
        const response = await fetch(`${url}/playtime/attachments/upload`, {
            method: "POST",
            headers: { Authorization: `Bearer ${guest.token}`, "X-Playtime-Media-Format": "secretbox-v1" },
            body: form,
            signal: AbortSignal.timeout(5000)
        })
        const receipt = await response.json()
        assert.equal(response.status, 200, JSON.stringify(receipt))
        assert.equal(receipt.sizeBytes, 64)
        const meter = await pool.query(
            "SELECT quota_group, size_bytes::int AS size FROM media_objects WHERE storage_key=$1",
            [receipt.attachmentKey]
        )
        assert.deepEqual(meter.rows, [{ quota_group: "guest", size: 64 }])
    })

    await t.test("friend requests hide blocked accounts and cap concurrent pending requests", async () => {
        const { rows } = await pool.query(
            `INSERT INTO users(username,email,password_hash,email_verified_at)
             SELECT 'FriendTarget' || id, 'friendtarget' || id || '@example.test', $1, NOW()
             FROM generate_series(1,52) id RETURNING id`,
            [hash]
        )
        const targets = rows.map(({ id }) => id)
        await pool.query("INSERT INTO user_blocks(blocker_id,blocked_id) VALUES ($1,$2)", [targets[49], alice.user.id])
        const missing = waitForEvent(left, "friend:request:error")
        left.emit("friend:request", { peerUserId: 2_147_483_000 })
        const missingError = await missing
        const blocked = waitForEvent(left, "friend:request:error")
        left.emit("friend:request", { peerUserId: targets[49] })
        assert.deepEqual(await blocked, missingError)
        await pool.query(
            "INSERT INTO friendships(user_id,friend_id,status) SELECT $1, id, 'pending' FROM unnest($2::int[]) id",
            [alice.user.id, targets.slice(0, 49)]
        )
        const admitted = waitForEvent(left, "friend:request:success")
        const rejected = waitForEvent(left, "friend:request:error")
        left.emit("friend:request", { peerUserId: targets[50] })
        left.emit("friend:request", { peerUserId: targets[51] })
        await admitted
        assert.equal((await rejected).err, "Достигнут лимит исходящих запросов в друзья")
        const pending = await pool.query(
            "SELECT COUNT(*)::int AS count FROM friendships WHERE user_id=$1 AND status='pending'",
            [alice.user.id]
        )
        assert.equal(pending.rows[0].count, 50)
        await pool.query("DELETE FROM friendships WHERE user_id=$1 AND friend_id=ANY($2::int[])", [
            alice.user.id,
            targets
        ])
    })

    const aliceBearer = { Authorization: `Bearer ${alice.token}` }
    const chatAuthorization = await fetch(`${url}/playtime/peers/blocked`, { headers: aliceBearer })
    assert.equal(chatAuthorization.status, 200)
    assert.deepEqual(await chatAuthorization.json(), { usernames: [], peers: [] })
    assert.equal((await fetch(`${url}/playtime/subscription/me`, { headers: aliceBearer })).status, 200)
    const pushRegistration = await fetch(`${url}/playtime/push/device`, {
        method: "PUT",
        headers: { ...aliceBearer, "Content-Type": "application/json" },
        body: JSON.stringify({
            provider: "rustore",
            token: "gateway-fixture-push-token",
            enabled: false,
            mutedChats: []
        })
    })
    assert.equal(pushRegistration.status, 200)
    t.diagnostic("Verified Chat and Gateway HTTP bearer authentication via auth-api with restricted database roles")

    const invitation = waitForEvent(right, "friend:request")
    left.emit("friend:request", { friendUsername: bob.user.username, peerUserId: bob.user.id })
    assert.equal((await invitation).user_id, alice.user.id)
    const accepted = waitForEvent(left, "friend:accept")
    right.emit("friend:accept", { friendUsername: alice.user.username, peerUserId: alice.user.id })
    await accepted

    const aliceKeys = nacl.box.keyPair()
    const bobKeys = nacl.box.keyPair()
    assertOk(await ack(left, "profile:setDmPublicKey", { publicKey: toBase64(aliceKeys.publicKey) }))
    assertOk(await ack(right, "profile:setDmPublicKey", { publicKey: toBase64(bobKeys.publicKey) }))
    const dm = "Gateway encrypted direct message"
    const received = waitForEvent(right, "message:receive")
    const directMessage = assertOk(
        await ack(left, "message:send", {
            peerUserId: bob.user.id,
            username: bob.user.username,
            content: boxEnvelope(Buffer.from(dm), aliceKeys, bobKeys),
            clientMessageId: randomUUID()
        })
    )
    const receivedDirect = await received
    assert.equal(receivedDirect.id, directMessage.id)
    assert.equal(Buffer.from(openBox(receivedDirect.content, aliceKeys.publicKey, bobKeys)).toString(), dm)
    const directHistory = waitForEvent(right, "message:getMessages:success")
    right.emit("message:getMessages", { peerUserId: alice.user.id, requestId: "gateway-dm" })
    assert.equal((await directHistory).messages[0].id, directMessage.id)

    const { roomId } = assertOk(await ack(left, "room:create", { name: "Gateway Room" }))
    const roomInvite = waitForEvent(right, "room:invite")
    assertOk(await ack(left, "room:addMember", { roomId, peerUserId: bob.user.id }))
    assert.equal((await roomInvite).roomId, roomId)
    const roomKey = nacl.randomBytes(nacl.secretbox.keyLength)
    assertOk(
        await ack(left, "room:e2eePutWraps", {
            roomId,
            wraps: {
                [alice.user.id]: boxEnvelope(roomKey, aliceKeys, aliceKeys),
                [bob.user.id]: boxEnvelope(roomKey, aliceKeys, bobKeys)
            }
        })
    )
    const { myWrap } = await ack(right, "room:e2eeBundle", { roomId })
    const bobRoomKey = openBox(myWrap.ciphertext, Buffer.from(myWrap.wrapperDmPublicKey, "base64"), bobKeys)
    const roomMessage = "Gateway encrypted room message"
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const roomCipher = nacl.secretbox(Buffer.from(roomMessage), nonce, roomKey)
    const roomReceive = waitForEvent(right, "message:receive", (message) => message.roomId === roomId)
    const roomSend = assertOk(
        await ack(left, "message:send", {
            roomId,
            content: `R2E1:${JSON.stringify({ n: toBase64(nonce), b: toBase64(roomCipher) })}`,
            clientMessageId: randomUUID()
        })
    )
    const roomDelivery = await roomReceive
    assert.equal(roomDelivery.id, roomSend.id)
    const envelope = JSON.parse(roomDelivery.content.slice(5))
    const decoded = nacl.secretbox.open(
        Buffer.from(envelope.b, "base64"),
        Buffer.from(envelope.n, "base64"),
        bobRoomKey
    )
    assert.equal(Buffer.from(decoded).toString(), roomMessage)
    const roomHistory = waitForEvent(right, "message:getMessages:success", (message) => message.roomId === roomId)
    right.emit("message:getMessages", { roomId, requestId: "gateway-room" })
    assert.equal((await roomHistory).messages[0].id, roomSend.id)
    t.diagnostic("Verified friend request, encrypted direct and room messages, and persisted histories")

    assert.equal((await ack(guestSocket, "room:enter", { roomId })).err, "Not a member")
    assertOk(await ack(left, "room:enter", { roomId }))
    const joinedParty = waitForEvent(left, "party:participant:joined")
    assertOk(await ack(right, "room:enter", { roomId }))
    assert.equal((await joinedParty).userId, bob.user.id)
    const leftParty = waitForEvent(left, "party:participant:left")
    right.emit("room:leave", { roomId })
    assert.equal((await leftParty).userId, bob.user.id)
    left.emit("room:leave", { roomId })
    t.diagnostic("Verified voice room membership checks and join/leave broadcasts")

    const incomingCall = waitForEvent(right, "call:incomingCall")
    const started = assertOk(await ack(left, "call:start", { peerUserId: bob.user.id }))
    assert.equal((await incomingCall).roomId, started.roomId)
    assert.equal(started.state.status, "request_receiver")
    const confirmation = waitForEvent(left, "call:confirmed")
    assertOk(await ack(right, "call:confirm", { roomId: started.roomId, accept: true }))
    assert.equal((await confirmation).roomId, started.roomId)
    const { state } = await ack(left, "call:current")
    assert.equal(state.status, "in_call")
    assert.equal(state.media.active, true)

    const participants = [
        { socket: left, ...state.caller },
        { socket: right, ...state.receiver }
    ]
    const iceConfigurations = await Promise.all(
        participants.map(async ({ socket }) => {
            const config = waitForEvent(socket, "webrtc:config")
            socket.emit("webrtc:config:request")
            const { iceServers } = await config
            const turn = iceServers.find((server) => server.urls === turnUrl)
            assert.ok(turn, "Room API returned the disposable TURN endpoint")
            return [turn]
        })
    )
    await verifyGatewayAudio(iceConfigurations, async (from, payload) => {
        const sender = participants[from]
        const receiver = participants[1 - from]
        const relayed = waitForEvent(receiver.socket, "webrtc:signal", (signal) => signal.type === payload.type)
        sender.socket.emit("webrtc:signal", {
            roomId: started.roomId,
            context: "direct",
            type: payload.type,
            targetUserId: receiver.id,
            ownershipRevision: sender.ownershipRevision,
            targetOwnershipRevision: receiver.ownershipRevision,
            payload
        })
        const signal = await relayed
        assert.equal(signal.roomId, started.roomId)
        assert.equal(signal.fromUserId, sender.id)
        assert.deepEqual(signal.payload, payload)
        return signal.payload
    })
    const ended = waitForEvent(right, "call:ended")
    const callHistory = waitForEvent(right, "dmThreadOp:new")
    left.emit("call:end", { roomId: started.roomId, ownershipRevision: state.media.ownershipRevision })
    assert.equal((await ended).roomId, started.roomId)
    assert.equal((await ack(left, "call:current")).state, null)
    assert.equal((await ack(right, "call:current")).state, null)
    assert.match((await callHistory).op.text, /^Звонок · /)
    t.diagnostic("Verified ringing, acceptance, offer/answer, bidirectional audio RTP, hang-up and call history")

    assertOk(await ack(right, "room:leaveRoom", { roomId }))
    const retained = await ack(left, "room:e2eeBundle", { roomId, epoch: 0, keyProtocol: 1 })
    assert.equal(retained.currentEpoch, 1)
    assert.deepEqual(
        Buffer.from(openBox(retained.myWrap.ciphertext, aliceKeys.publicKey, aliceKeys)),
        Buffer.from(roomKey)
    )
    assert.ok((await ack(right, "room:e2eeBundle", { roomId, epoch: 0, keyProtocol: 1 })).err)
    const current = await ack(left, "room:e2eeBundle", { roomId, keyProtocol: 1 })
    assert.equal(current.epoch, 1)
    assert.equal(current.wrapCount, 0)
    const replacement = nacl.randomBytes(nacl.secretbox.keyLength)
    assertOk(
        await ack(left, "room:e2eePutWraps", {
            roomId,
            epoch: current.epoch,
            wraps: {
                [alice.user.id]: boxEnvelope(replacement, aliceKeys, aliceKeys)
            }
        })
    )
    assertOk(await ack(left, "room:addMember", { roomId, peerUserId: bob.user.id }))
    const rejoined = await ack(right, "room:e2eeBundle", { roomId, keyProtocol: 1 })
    assert.equal(rejoined.epoch, 2)
    assert.equal(rejoined.wrapCount, 0)
    const prior = await ack(right, "room:e2eeBundle", { roomId, epoch: 0, keyProtocol: 1 })
    assert.equal(prior.myWrap, null)
    const rejoinedHistory = waitForEvent(right, "message:getMessages:success", (row) => row.roomId === roomId)
    right.emit("message:getMessages", { roomId, requestId: "gateway-room-rejoined" })
    assert.deepEqual((await rejoinedHistory).messages, [])
    t.diagnostic("Verified room key rotation, surviving members’ old keys and history isolation after rejoining")

    await fixture.stopApp("room-api")
    assert.equal((await ack(left, "call:current")).err, "Сервис временно недоступен")
    const loginDuringOutage = await post(url, "login", { email: "alice@example.test", password })
    assert.equal(loginDuringOutage.user.id, alice.user.id)
    const refreshed = await post(url, "refresh", { refreshToken: alice.refreshToken })
    assert.equal(refreshed.user.id, alice.user.id)
    assert.notEqual(refreshed.refreshToken, alice.refreshToken)
    left.emit("auth:refresh", { token: refreshed.token })
    assert.equal((await ack(left, "get:username")).userId, alice.user.id)

    const deliveryDuringOutage = waitForEvent(right, "message:receive")
    const outageMessage = "Delivered while the room service is stopped"
    const sentDuringOutage = assertOk(
        await ack(left, "message:send", {
            peerUserId: bob.user.id,
            username: bob.user.username,
            content: boxEnvelope(Buffer.from(outageMessage), aliceKeys, bobKeys),
            clientMessageId: randomUUID()
        })
    )
    const outageDelivery = await deliveryDuringOutage
    assert.equal(outageDelivery.id, sentDuringOutage.id)
    assert.equal(Buffer.from(openBox(outageDelivery.content, aliceKeys.publicKey, bobKeys)).toString(), outageMessage)

    await fixture.startApp("room-api")
    await waitUntil(async () => (await ack(left, "call:current")).state === null, "room reconnect", 10000)
    const recoveredRinging = waitForEvent(right, "call:incomingCall")
    const recovered = assertOk(await ack(left, "call:start", { peerUserId: bob.user.id }))
    assert.equal((await recoveredRinging).roomId, recovered.roomId)
    const recoveredConfirmed = waitForEvent(left, "call:confirmed")
    assertOk(await ack(right, "call:confirm", { roomId: recovered.roomId, accept: true }))
    assert.equal((await recoveredConfirmed).roomId, recovered.roomId)
    const recoveredState = (await ack(left, "call:current")).state
    assert.equal(recoveredState.status, "in_call")
    const recoveredEnded = waitForEvent(right, "call:ended")
    left.emit("call:end", { roomId: recovered.roomId, ownershipRevision: recoveredState.media.ownershipRevision })
    assert.equal((await recoveredEnded).roomId, recovered.roomId)
    t.diagnostic(
        "Verified login, session refresh and encrypted chat during room-api outage and a new call after restart"
    )

    const disconnected = waitForEvent(left, "disconnect")
    const revoked = await post(url, "revoke", { token: refreshed.token, refreshToken: refreshed.refreshToken })
    assert.equal(revoked.ok, true)
    assert.equal(await disconnected, "io server disconnect")
    assert.equal((await post(url, "tokenValid", { token: refreshed.token }, 401)).valid, false)
    await assert.rejects(connect(sockets, url, refreshed.token, "websocket"), /Authentication error/)
    assert.equal((await ack(right, "get:username")).userId, bob.user.id)
    t.diagnostic("Verified HTTP session revocation disconnects the target socket and rejects reconnect")

    const adminHeaders = { "Content-Type": "application/json", Origin: url, "X-PlayTime-Admin": "1" }
    const admin = await fetch(`${url}/playtime/admin/session`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ key: adminKey })
    })
    assert.equal(admin.status, 200)
    const cookie = admin.headers.get("set-cookie").split(";")[0]
    const registeredAt = "2025-01-02T03:04:05.000Z"
    await pool.query("UPDATE users SET created_at = $2 WHERE id = $1", [alice.user.id, registeredAt])
    await pool.query("UPDATE users SET created_at = NULL WHERE id = $1", [bob.user.id])
    const usersResponse = await fetch(`${url}/playtime/admin/users?query=Gateway`, {
        headers: { Origin: url, Cookie: cookie }
    })
    assert.equal(usersResponse.status, 200)
    const { users } = await usersResponse.json()
    assert.equal(users.find(({ id }) => id === alice.user.id).createdAt, registeredAt)
    assert.equal(users.find(({ id }) => id === bob.user.id).createdAt, null)
    const report = await fetch(`${url}/playtime/peers/${alice.user.username}/report`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bob.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ peerUserId: alice.user.id, reason: "gateway report fixture" })
    })
    assert.equal(report.status, 200)
    const reportsUrl = `${url}/playtime/admin/reports`
    const reportsHeaders = { ...adminHeaders, Cookie: cookie }
    const reports = await fetch(reportsUrl, { headers: reportsHeaders })
    assert.equal(reports.status, 200)
    const [reported] = (await reports.json()).reports
    assert.equal(reported.reported, alice.user.username)
    assert.equal(reported.resolved_at, null)
    const resolved = await fetch(`${reportsUrl}/${reported.id}/resolve`, { method: "POST", headers: reportsHeaders })
    assert.equal(resolved.status, 200)
    assert.notEqual((await (await fetch(reportsUrl, { headers: reportsHeaders })).json()).reports[0].resolved_at, null)
    t.diagnostic("Verified Chat stores and resolves reports through authenticated Gateway routes")

    const blockAccount = () =>
        fetch(`${url}/playtime/admin/users/${bob.user.id}/block`, {
            method: "PATCH",
            headers: { ...adminHeaders, Cookie: cookie },
            body: JSON.stringify({ blocked: true, reason: "fixture" })
        })
    await pool.query("ALTER TABLE admin_audit_log ADD CONSTRAINT fixture_reject_block CHECK (action <> 'user.block')")
    try {
        assert.equal((await blockAccount()).status, 500)
        assert.equal((await post(url, "tokenValid", { token: bob.token })).valid, true)
        assert.equal((await ack(right, "get:username")).userId, bob.user.id)
    } finally {
        await pool.query("ALTER TABLE admin_audit_log DROP CONSTRAINT fixture_reject_block")
    }
    const blockedSocket = waitForEvent(right, "disconnect")
    const block = await blockAccount()
    assert.equal(block.status, 200)
    assert.equal((await block.json()).isBlocked, true)
    assert.equal(await blockedSocket, "io server disconnect")
    assert.equal((await post(url, "tokenValid", { token: bob.token }, 401)).valid, false)
    const blockState = await pool.query(
        "SELECT is_blocked, auth_version, (SELECT COUNT(*) FROM auth_sessions WHERE user_id=users.id AND revoked_at IS NULL)::int AS active_sessions FROM users WHERE id=$1",
        [bob.user.id]
    )
    assert.deepEqual(blockState.rows[0], { is_blocked: true, auth_version: "1", active_sessions: 0 })
    const audit = await pool.query(
        "SELECT details FROM admin_audit_log WHERE target_user_id=$1 AND action='user.block'",
        [bob.user.id]
    )
    assert.deepEqual(audit.rows, [{ details: { clientIp: "127.0.0.1", reason: "fixture" } }])
    t.diagnostic("Verified admin block, session revocation and audit commit together in auth-api")
})
