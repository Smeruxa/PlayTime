const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const crypto = require("node:crypto")
const { execFile } = require("node:child_process")
const { promisify } = require("node:util")
const { once } = require("node:events")
const { createRequire } = require("node:module")
const exec = promisify(execFile)
const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fixture(t) {
    const docker = async (...args) => (await exec("docker", args, { timeout: 60000 })).stdout.trim()
    assert.match(await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}"), /^unix:\/\//)
    const containers = [],
        suffix = crypto.randomBytes(6).toString("hex"),
        password = crypto.randomBytes(24).toString("hex")
    let pool, redis, server
    t.after(async () => {
        if (server) {
            server.closeAllConnections()
            await new Promise((resolve) => server.close(resolve))
        }
        await Promise.allSettled([pool?.end(), redis?.quit()])
        await Promise.allSettled(containers.map((id) => docker("rm", "-f", id)))
    })
    containers.push(
        await docker(
            "run",
            "--rm",
            "-d",
            "--name",
            `playtime-push-pg-${suffix}`,
            "--label",
            "playtime.qa=push-integration",
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
            `playtime-push-redis-${suffix}`,
            "--label",
            "playtime.qa=push-integration",
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
    Object.assign(process.env, {
        NODE_ENV: "test",
        PG_HOST: "127.0.0.1",
        PG_PORT: String(pgPort),
        PG_USER: "playtime_test",
        PG_DATABASE: "playtime_test",
        PG_PASSWORD: password,
        PG_STATEMENT_TIMEOUT_MS: "5000",
        REDIS_URL: `redis://:${password}@127.0.0.1:${redisPort}/0`,
        JWT_SECRET_ENV: "isolated-push-test-only-never-production-secret"
    })
    delete process.env.RUSTORE_PUSH_PROJECT_ID
    delete process.env.RUSTORE_PUSH_SERVICE_TOKEN
    require("tsx/cjs")
    const config = require("../../apps/shared/config.ts")
    pool = config.pool
    redis = config.redis
    redis.on("error", () => {})
    const deadline = Date.now() + 15000
    while (true) {
        try {
            await pool.query("SELECT 1")
            assert.equal(await redis.ping(), "PONG")
            break
        } catch (error) {
            if (Date.now() > deadline) throw error
            await wait(50)
        }
    }
    await pool.query(await fs.readFile(path.join(root, "apps/database/schema.sql"), "utf8"))
    for (const name of (await fs.readdir(path.join(root, "apps/database/migrations")))
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        await pool.query(await fs.readFile(path.join(root, "apps/database/migrations", name), "utf8"))
    }
    const devices = require("../../apps/gateway/push/repository.ts")
    const { enqueuePush } = require("../../apps/database/pushOutbox.ts")
    const { isRingingRecipient } = require("../../apps/room-api/ringingRecipientRoute.ts")
    const repository = { ...devices, enqueuePush, pushQueue: devices.createPushQueue(isRingingRecipient) }
    const express = backendRequire("express"),
        app = express()
    const { configureBearerAccess } = require("../../apps/shared/http/bearerAuth.ts")
    const { verifyBearerAccess } = require("../../apps/auth-api/http/bearerAuthMiddleware.ts")
    configureBearerAccess(app, verifyBearerAccess)
    app.use(express.json())
    app.use("/push", require("../../apps/gateway/routes/pushDevices.ts").default)
    server = app.listen(0, "127.0.0.1")
    await once(server, "listening")
    const input = (token) => ({ provider: "rustore", token, enabled: true, mutedChats: [] })
    const user = async (name) =>
        (
            await pool.query("INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id", [
                name,
                `${name}@example.test`,
                "test-only-hash"
            ])
        ).rows[0].id
    const session = async (id) => {
        const sid = crypto.randomUUID()
        await pool.query(
            "INSERT INTO auth_sessions(id,user_id,session_version,expires_at) VALUES($1,$2,0,NOW()+INTERVAL '1 hour')",
            [sid, id]
        )
        return sid
    }
    const setup = async () => {
        await pool.query("TRUNCATE users CASCADE")
        await redis.flushdb()
        const sender = await user("sender"),
            receiver = await user("receiver"),
            other = await user("other")
        const sid = await session(receiver),
            otherSid = await session(other)
        await pool.query(
            "INSERT INTO friendships(user_id,friend_id,status) VALUES($1,$2,'accepted'),($1,$3,'accepted')",
            [sender, receiver, other]
        )
        await repository.registerPushDevice(receiver, sid, input("local-test-device-token"))
        return { sender, receiver, other, sid, otherSid }
    }
    const message = async (state, roomId) =>
        (
            await pool.query(
                "INSERT INTO messages(sender_id,receiver_id,room_id,content,is_dm_e2ee) VALUES($1,$2,$3,$4,$5) RETURNING id",
                [
                    state.sender,
                    roomId ? null : state.receiver,
                    roomId ?? null,
                    "opaque-encrypted-content-never-in-push",
                    !roomId
                ]
            )
        ).rows[0].id
    const event = (state, messageId, extra = {}) => ({
        eventKey: `m:${messageId}`,
        chatKey: "dm:sender",
        senderId: state.sender,
        recipients: [state.receiver],
        messageId,
        target: { version: 1, userId: state.receiver, kind: "chat", id: state.sender, isRoom: false, name: "sender" },
        title: "sender",
        expiresAt: Date.now() + 60000,
        ...extra
    })
    const request = async (method, body, token) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/push/device`, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        })
        return { status: response.status, body: await response.json() }
    }
    const access = require("../../apps/auth-api/auth/accessToken.ts")
    return { pool, redis, repository, input, setup, message, event, request, access, session }
}

test("mobile push PostgreSQL/Redis transaction and authorization integration", { timeout: 180000 }, async (t) => {
    const f = await fixture(t),
        checks = []
    await t.test("migration is idempotent and HTTP registration requires an active durable session", async () => {
        await f.pool.query(await fs.readFile(path.join(root, "apps/database/migrations/031_mobile_push.sql"), "utf8"))
        const s = await f.setup(),
            body = f.input("registered-test-token")
        assert.equal((await f.request("PUT", body)).status, 401)
        const token = f.access.signUserAccessToken({
            id: s.receiver,
            username: "receiver",
            sessionVersion: 0,
            sessionId: s.sid
        })
        assert.equal((await f.request("PUT", { ...body, mutedChats: ["bad"] }, token)).status, 400)
        assert.deepEqual(await f.request("PUT", body, token), {
            status: 200,
            body: { registered: true, deliveryReady: false }
        })
        await f.pool.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1", [s.sid])
        assert.equal((await f.request("PUT", body, token)).status, 401)
        checks.push("migration/API validation/active session")
    })
    await t.test("rotation and account rebind remove queued deliveries from the old owner", async () => {
        const s = await f.setup(),
            id = await f.message(s)
        await f.repository.enqueuePush(f.event(s, id))
        assert.equal((await f.pool.query("SELECT COUNT(*)::int n FROM push_outbox")).rows[0].n, 1)
        await f.repository.registerPushDevice(s.receiver, s.sid, f.input("rotated-test-token"))
        assert.equal((await f.pool.query("SELECT COUNT(*)::int n FROM push_outbox")).rows[0].n, 0)
        await f.repository.enqueuePush(f.event(s, id))
        const [claimed] = await f.repository.pushQueue.claim()
        await f.repository.registerPushDevice(s.other, s.otherSid, f.input("rotated-test-token"))
        assert.equal(await f.repository.pushQueue.allowed(claimed), false)
        assert.deepEqual((await f.pool.query("SELECT user_id,session_id FROM push_devices")).rows, [
            { user_id: s.other, session_id: s.otherSid }
        ])
        await f.repository.pushQueue.invalidate(claimed.deviceId, "obsolete-token")
        assert.equal((await f.pool.query("SELECT COUNT(*)::int n FROM push_devices")).rows[0].n, 1)
        checks.push("token rotation/rebind/claimed-owner revalidation")
    })
    await t.test("transaction rollback, deduplication and concurrent claims preserve the outbox", async () => {
        const s = await f.setup(),
            db = await f.pool.connect()
        try {
            await db.query("BEGIN")
            const id = (
                await db.query("INSERT INTO messages(sender_id,receiver_id,content) VALUES($1,$2,$3) RETURNING id", [
                    s.sender,
                    s.receiver,
                    "rolled-back-ciphertext"
                ])
            ).rows[0].id
            await f.repository.enqueuePush(f.event(s, id), db)
            await db.query("ROLLBACK")
            assert.equal((await f.pool.query("SELECT COUNT(*)::int n FROM push_outbox")).rows[0].n, 0)
        } finally {
            db.release()
        }
        const id = await f.message(s)
        await Promise.all([f.repository.enqueuePush(f.event(s, id)), f.repository.enqueuePush(f.event(s, id))])
        const results = await Promise.all([f.repository.pushQueue.claim(), f.repository.pushQueue.claim()])
        assert.equal(results.flat().length, 1)
        const claimed = results.flat()[0]
        assert.equal(claimed.attempts, 1)
        assert.equal(JSON.stringify(claimed).includes("opaque-encrypted-content"), false)
        await f.repository.pushQueue.retry(claimed.id, 0)
        assert.equal((await f.repository.pushQueue.claim())[0].attempts, 2)
        checks.push("transaction rollback/dedup/SKIP LOCKED/retry/privacy")
    })
    await t.test("consent, mute, revoke, account version and peer blocks are rechecked after claim", async () => {
        for (const mutation of ["disable", "mute", "revoke", "version", "blocked", "unfriend"]) {
            const s = await f.setup(),
                id = await f.message(s)
            await f.repository.enqueuePush(f.event(s, id))
            const [claimed] = await f.repository.pushQueue.claim()
            assert.equal(await f.repository.pushQueue.allowed(claimed), true)
            if (mutation === "disable")
                await f.repository.registerPushDevice(s.receiver, s.sid, {
                    ...f.input("local-test-device-token"),
                    enabled: false
                })
            if (mutation === "mute")
                await f.repository.registerPushDevice(s.receiver, s.sid, {
                    ...f.input("local-test-device-token"),
                    mutedChats: ["dm:sender"]
                })
            if (mutation === "revoke")
                await f.pool.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1", [s.sid])
            if (mutation === "version")
                await f.pool.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1", [s.receiver])
            if (mutation === "blocked")
                await f.pool.query("INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)", [
                    s.receiver,
                    s.sender
                ])
            if (mutation === "unfriend")
                await f.pool.query("DELETE FROM friendships WHERE user_id=$1 AND friend_id=$2", [s.sender, s.receiver])
            assert.equal(await f.repository.pushQueue.allowed(claimed), false, mutation)
        }
        checks.push("post-claim consent/mute/revoke/version/block/membership")
    })
    await t.test("room notifications require current membership and an accessible E2EE key epoch", async () => {
        const s = await f.setup()
        const roomId = (
            await f.pool.query("INSERT INTO rooms(name,created_by) VALUES($1,$2) RETURNING id", ["Test room", s.sender])
        ).rows[0].id
        await f.pool.query("INSERT INTO room_members(room_id,user_id) VALUES($1,$2)", [roomId, s.receiver])
        const id = await f.message(s, roomId)
        await f.repository.enqueuePush(
            f.event(s, id, {
                roomId,
                chatKey: `room:${roomId}`,
                target: { version: 1, userId: s.receiver, kind: "chat", id: roomId, isRoom: true, name: "Test room" }
            })
        )
        const [claimed] = await f.repository.pushQueue.claim()
        assert.equal(await f.repository.pushQueue.allowed(claimed), false, "No key wrap means no room content access")
        await f.pool.query(
            "INSERT INTO room_e2ee_wraps(room_id,user_id,wrapper_user_id,ciphertext,e2ee_visible_after_id) VALUES($1,$2,$3,$4,$5)",
            [roomId, s.receiver, s.sender, "opaque-key-wrap", id]
        )
        assert.equal(await f.repository.pushQueue.allowed(claimed), false, "Old history cannot trigger notifications")
        await f.pool.query("UPDATE room_e2ee_wraps SET e2ee_visible_after_id=$1 WHERE room_id=$2", [id - 1, roomId])
        assert.equal(await f.repository.pushQueue.allowed(claimed), true)
        await f.pool.query("DELETE FROM room_members WHERE room_id=$1 AND user_id=$2", [roomId, s.receiver])
        assert.equal(await f.repository.pushQueue.allowed(claimed), false)
        checks.push("room membership/key wrap/history boundary")
    })
    await t.test("calls require a live ringing Redis state, expired deliveries disappear", async () => {
        const s = await f.setup(),
            room = "local-test-call"
        await f.repository.enqueuePush(
            f.event(s, undefined, {
                eventKey: `c:${room}`,
                callRoomId: room,
                target: { version: 1, userId: s.receiver, kind: "call" }
            })
        )
        const [claimed] = await f.repository.pushQueue.claim()
        assert.equal(await f.repository.pushQueue.allowed(claimed), false)
        await f.redis.set(
            `call:room:${room}`,
            JSON.stringify({
                status: "request_receiver",
                beginer_id: s.sender,
                receiver_id: s.receiver,
                expires_at: Date.now() + 30000
            })
        )
        assert.equal(await f.repository.pushQueue.allowed(claimed), true)
        await f.redis.set(
            `call:room:${room}`,
            JSON.stringify({ status: "in_call", beginer_id: s.sender, receiver_id: s.receiver })
        )
        assert.equal(await f.repository.pushQueue.allowed(claimed), false)
        await f.pool.query("UPDATE push_outbox SET expires_at=NOW()-INTERVAL '1 second'")
        assert.deepEqual(await f.repository.pushQueue.claim(), [])
        assert.equal((await f.pool.query("SELECT COUNT(*)::int n FROM push_outbox")).rows[0].n, 0)
        checks.push("call ringing state/TTL")
    })
    await t.test("registration cannot bind a mismatched or already revoked session", async () => {
        const s = await f.setup()
        await assert.rejects(f.repository.registerPushDevice(s.other, s.sid, f.input("wrong-owner-token")))
        await f.pool.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1", [s.sid])
        await assert.rejects(f.repository.registerPushDevice(s.receiver, s.sid, f.input("revoked-session-token")))
        checks.push("registration revalidation after auth race")
    })
    await t.test("revocation while registration waits for its transaction lock prevents rebinding", async () => {
        const s = await f.setup(),
            lock = await f.pool.connect()
        const lockKey = `push:${s.sid}`
        await lock.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey])
        try {
            const registration = assert.rejects(
                f.repository.registerPushDevice(s.receiver, s.sid, f.input("racing-revoked-token"))
            )
            const deadline = Date.now() + 5000
            while (
                !(
                    await f.pool.query(
                        "SELECT COUNT(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory'"
                    )
                ).rows[0].n
            ) {
                if (Date.now() > deadline) throw new Error("Registration did not reach its advisory lock")
                await wait(10)
            }
            await f.pool.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1", [s.sid])
            await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey])
            await registration
            assert.equal(
                (
                    await f.pool.query("SELECT COUNT(*)::int n FROM push_devices WHERE token=$1", [
                        "racing-revoked-token"
                    ])
                ).rows[0].n,
                0
            )
        } finally {
            await lock.query("SELECT pg_advisory_unlock_all()")
            lock.release()
        }
        checks.push("concurrent revoke during registration")
    })
    if (process.env.PUSH_BACKEND_REPORT)
        await fs.writeFile(
            process.env.PUSH_BACKEND_REPORT,
            JSON.stringify({ status: checks.length === 8 ? "passed" : "failed", checks }, null, 4) + "\n"
        )
})
