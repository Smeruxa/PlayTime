import { resolve } from "node:path"
import express from "express"
import crypto from "node:crypto"
import net from "node:net"
import { sessionRevocationCodeHash } from "../../auth-api/auth/sessionRevocationCode"
import { once } from "node:events"
import emailVerificationRoutes from "../../auth-api/routes/emailVerification"
import keyTransferRoutes from "../../auth-api/routes/keyTransfer"
import sessionsRoutes from "../../auth-api/routes/sessions"
import peerSafetyRoutes from "../../chat-api/routes/peerSafety"
import { listPeerReports, resolvePeerReport } from "../../chat-api/services/reports"
import { createAdminReportRoutes } from "../admin/reportRoutes"
import voiceRoutes from "../../chat-api/routes/voice"
import attachmentRoutes from "../../chat-api/routes/attachments"
import { recoveryCodeHash } from "../../auth-api/auth/recoveryCode"
import { JWT_SECRET } from "../../shared/config"
import registerRooms from "../../chat-api/socket/roomsDb"
import registerPartyRoomsSocket, { type RoomEnterAck } from "../../room-api/socket/party/roomsSocket"
import type { FeatureIo, FeatureListener, FeatureRooms, FeatureSocket } from "../../shared/socket/featureContext"
import { localPartyServices } from "../legacy/partyServices"
import { createLegacyPeerBlockEffects } from "../legacy/peerBlockEffects"
import assert from "node:assert/strict"
import { before, beforeEach, after, test } from "node:test"
import fs from "node:fs"
import { Pool } from "pg"
import { pool, redis } from "../../shared/config"
import { runPendingMigrations } from "../../database/runMigrations"
import { issueRefreshToken, takeRefreshToken, revokeAllRefreshTokensForUser } from "../../auth-api/auth/refreshToken"
import { signUserAccessToken, verifyUserAccessToken } from "../../auth-api/auth/accessToken"
import { getSessionVersion, revokeUserCredentials } from "../../auth-api/auth/sessionVersion"
import { blacklistAccessJti } from "../../auth-api/auth/tokenBlacklist"
import { migrateLegacySessions } from "../../auth-api/auth/migrateLegacySessions"
import registerRoomE2eeKeys from "../../chat-api/socket/messages/roomE2eeKeys"
import registerMessageEdit from "../../chat-api/socket/messages/edit"
import registerMessageHistory from "../../chat-api/socket/messages/history"
import registerMessageSend from "../../chat-api/socket/messages/send"
import registerMessagePreviews from "../../chat-api/socket/messages/previews"
import { canSeeRoomMessage } from "../../chat-api/socket/messages/visibility"
import { passwordPolicyError } from "../../shared/auth/passwordPolicy"
import { getLimitsForUser } from "../subscription/subscriptionService"
import { adminSessionRouter } from "../routes/adminSession"
import { ADMIN_TEST_ORIGIN, closeAdminFixture, configureAdminFixture, loginAdminFixture } from "./adminFixture"
import { configureBearerAccess } from "../../shared/http/bearerAuth"
import { verifyBearerAccess } from "../../auth-api/http/bearerAuthMiddleware"

before(async () => {
    if (
        !process.env.PG_DATABASE?.startsWith("playtime_test_") ||
        process.env.PG_PORT !== "16390" ||
        process.env.REDIS_URL !== "redis://127.0.0.1:16389"
    )
        throw new Error("Isolated test databases required")
    await pool.query(fs.readFileSync(resolve(__dirname, "../../database/schema.sql"), "utf8"))
    await runPendingMigrations()
    configureAdminFixture()
})
beforeEach(async () => {
    await pool.query("DELETE FROM users")
    await pool.query("DELETE FROM user_reports")
    await pool.query("DELETE FROM revoked_access_tokens")
    await pool.query("DELETE FROM auth_migration_state")
    await redis.flushdb()
})
after(async () => {
    closeAdminFixture()
    await pool.end()
    await redis.quit()
})
async function user() {
    const row = (
        await pool.query(
            "INSERT INTO users(username,email,password_hash) VALUES ('tester','test@example.test','not-a-real-hash') RETURNING id,username"
        )
    ).rows[0]
    return {
        id: row.id as number,
        username: row.username as string,
        sessionVersion: 0,
        sessionId: undefined as string | undefined
    }
}

test("credential revocation survives losing all Redis data and a new application connection", async () => {
    const account = await user()
    const refresh = await issueRefreshToken(account)
    const token = signUserAccessToken(account)
    await verifyUserAccessToken(token)
    await revokeUserCredentials(account.id)
    await revokeAllRefreshTokensForUser(account.id)
    await redis.flushdb()
    await assert.rejects(verifyUserAccessToken(token))
    assert.equal(await takeRefreshToken(refresh), null)
    assert.equal(await getSessionVersion(account.id), 1)
})

test("refresh rotation is one-use under concurrency and cannot resurrect a revoked device", async () => {
    const account = await user()
    const raw = await issueRefreshToken(account)
    const contenders = await Promise.all(Array.from({ length: 8 }, () => takeRefreshToken(raw)))
    assert.equal(contenders.filter(Boolean).length, 1)
    const taken = contenders.find(Boolean)!
    await revokeAllRefreshTokensForUser(account.id)
    await assert.rejects(issueRefreshToken(taken))
})

test("revoking one device preserves another device and JWT logout revocation is durable", async () => {
    const account = await user()
    const one = { ...account },
        two = { ...account }
    await issueRefreshToken(one)
    await issueRefreshToken(two)
    const firstToken = signUserAccessToken(one),
        secondToken = signUserAccessToken(two)
    await pool.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1", [one.sessionId])
    await assert.rejects(verifyUserAccessToken(firstToken))
    const claims = await verifyUserAccessToken(secondToken)
    await blacklistAccessJti(claims.jti, claims.exp)
    await redis.flushdb()
    await assert.rejects(verifyUserAccessToken(secondToken))
})

test("password and version changes roll back together in a failed transaction", async () => {
    const account = await user(),
        client = await pool.connect()
    try {
        await client.query("BEGIN")
        await revokeUserCredentials(account.id, client)
        await client.query("UPDATE users SET password_hash='new-value' WHERE id=$1", [account.id])
        await client.query("ROLLBACK")
        assert.equal(await getSessionVersion(account.id), 0)
        assert.equal(
            (await pool.query("SELECT password_hash FROM users WHERE id=$1", [account.id])).rows[0].password_hash,
            "not-a-real-hash"
        )
    } finally {
        client.release()
    }
})

test("legacy migration imports only nonrevoked credentials and cannot roll back from old Redis values", async () => {
    const account = await user(),
        good = "a".repeat(64),
        revoked = "b".repeat(64)
    await redis.set(`auth:session-version:${account.id}`, "2")
    await redis.set("rt:" + good, JSON.stringify({ ...account, sessionVersion: 2 }), "EX", 100)
    await redis.set("rt:" + revoked, JSON.stringify(account), "EX", 100)
    await migrateLegacySessions()
    assert.equal(await getSessionVersion(account.id), 2)
    assert.equal((await takeRefreshToken(good))?.sessionVersion, 2)
    assert.equal(await takeRefreshToken(revoked), null)
    await redis.set(`auth:session-version:${account.id}`, "0")
    await migrateLegacySessions()
    assert.equal(await getSessionVersion(account.id), 2)
})

test("subscription reads reuse each transaction client even with a fully occupied pool", async () => {
    const account = await user()
    const bounded = new Pool({
        user: process.env.PG_USER,
        host: process.env.PG_HOST,
        database: process.env.PG_DATABASE,
        password: process.env.PG_PASSWORD,
        port: Number(process.env.PG_PORT),
        max: 2,
        connectionTimeoutMillis: 1000
    })
    const clients = await Promise.all([bounded.connect(), bounded.connect()])
    try {
        await Promise.all(
            clients.map(async (client) => {
                await client.query("BEGIN")
                assert.equal((await getLimitsForUser(account.id, client)).planSlug, "free")
                await client.query("ROLLBACK")
            })
        )
    } finally {
        clients.forEach((client) => client.release())
        await bounded.end()
    }
})

function feature(register: (ctx: any) => void, id: number, username: string) {
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>()
    const events: { user: string; event: string; payload: any }[] = []
    register({
        user: { id, username },
        socket: {
            on: (name: string, fn: any) => handlers.set(name, fn),
            emit: (event: string, payload: unknown) => events.push({ user: String(id), event, payload })
        },
        io: {
            to: (target: string) => ({
                emit: (event: string, payload: unknown) => events.push({ user: target, event, payload })
            })
        }
    })
    return { handlers, events }
}
async function addUser(username: string) {
    return (
        await pool.query(
            "INSERT INTO users(username,email,password_hash,dm_public_key) VALUES ($1,$2,'unused',$3) RETURNING id",
            [username, username + "@example.test", Buffer.alloc(32, username.length).toString("base64")]
        )
    ).rows[0].id as number
}
const envelope = (prefix = "R2E1:") =>
    prefix + JSON.stringify({ n: Buffer.alloc(24).toString("base64"), b: Buffer.alloc(32).toString("base64") })
async function group() {
    const owner = await addUser("owner"),
        member = await addUser("member"),
        newcomer = await addUser("newcomer")
    const room = (await pool.query("INSERT INTO rooms(name,created_by) VALUES ('testroom',$1) RETURNING id", [owner]))
        .rows[0].id as number
    for (const uid of [owner, member, newcomer])
        await pool.query("INSERT INTO room_members(room_id,user_id) VALUES ($1,$2)", [room, uid])
    const oldId = (
        await pool.query("INSERT INTO messages(sender_id,room_id,content) VALUES ($1,$2,$3) RETURNING id", [
            owner,
            room,
            envelope()
        ])
    ).rows[0].id as number
    for (const uid of [owner, member, newcomer])
        await pool.query(
            "INSERT INTO room_e2ee_wraps(room_id,user_id,wrapper_user_id,wrapper_public_key,ciphertext,e2ee_visible_after_id) SELECT $1,$2,$3,dm_public_key,$4,$5 FROM users WHERE id=$3",
            [room, uid, owner, envelope("E2E1:"), uid === newcomer ? oldId : 0]
        )
    return { owner, member, newcomer, room, oldId }
}

test("room key snapshots survive wrapper key rotation and deletion", async () => {
    const { owner, member, room } = await group()
    const oldKey = (await pool.query("SELECT dm_public_key FROM users WHERE id=$1", [owner])).rows[0].dm_public_key
    await pool.query("UPDATE users SET dm_public_key=$1 WHERE id=$2", [Buffer.alloc(32, 99).toString("base64"), owner])
    await pool.query("UPDATE rooms SET created_by=$1 WHERE id=$2", [member, room])
    await pool.query("DELETE FROM users WHERE id=$1", [owner])
    const f = feature(registerRoomE2eeKeys, member, "member")
    let response: any
    await f.handlers.get("room:e2eeBundle")!({ roomId: room, keyProtocol: 1, epoch: 0 }, (value: unknown) => {
        response = value
    })
    assert.equal(response.myWrap.wrapperDmPublicKey, oldKey)
})

test("late members cannot read, edit-relay, or reply-preview pre-join room history", async () => {
    const { owner, member, newcomer, room, oldId } = await group()
    assert.equal(await canSeeRoomMessage(newcomer, room, oldId), false)
    assert.equal(await canSeeRoomMessage(member, room, oldId), true)
    const edit = feature(registerMessageEdit, owner, "owner")
    await edit.handlers.get("message:edit")!({ id: oldId, roomId: room, content: envelope() })
    assert(edit.events.some((e) => e.user === String(member)))
    assert(!edit.events.some((e) => e.user === String(newcomer)))
    const next = await pool.query(
        "INSERT INTO messages(sender_id,room_id,content,reply_to_id) VALUES ($1,$2,$3,$4) RETURNING id",
        [owner, room, envelope(), oldId]
    )
    const history = feature(registerMessageHistory, newcomer, "newcomer")
    await history.handlers.get("message:getMessages")!({ roomId: room, requestId: "new-chat" })
    const reply = history.events.find((e) => e.event === "message:getMessages:success")!.payload
    assert.equal(reply.requestId, "new-chat")
    assert.equal(reply.messages.length, 1)
    assert.equal(reply.messages[0].id, next.rows[0].id)
    assert.equal(reply.messages[0].reply_to_id, null)
    assert.equal(reply.messages[0].reply_sender_username, null)
})

test("simultaneous message retries persist once and return the same durable receipt", async () => {
    const { owner, member, room } = await group()
    const payload = { roomId: room, content: envelope(), clientMessageId: "11111111-1111-4111-8111-111111111111" }
    const sender = feature(registerMessageSend, owner, "owner")
    const results = await Promise.all(
        Array.from(
            { length: 5 },
            () =>
                new Promise<any>((resolve) => {
                    void sender.handlers.get("message:send")!(payload, resolve)
                })
        )
    )
    assert(
        results.every((r) => r.success),
        JSON.stringify(results)
    )
    assert.equal(new Set(results.map((r) => r.id)).size, 1)
    assert.equal(results.filter((r) => !r.duplicate).length, 1)
    assert.equal(sender.events.filter((e) => e.event === "message:receive" && e.user === String(member)).length, 1)
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM message_send_receipts")).rows[0].n, 1)
    const again = feature(registerMessageSend, owner, "owner")
    await redis.flushdb()
    let ack: any
    await again.handlers.get("message:send")!(payload, (value: unknown) => {
        ack = value
    })
    assert.equal(ack.id, results[0].id)
    assert.equal(ack.duplicate, true)
})

test("set-based previews preserve unread counts and room history boundaries", async () => {
    const { owner, newcomer, room } = await group()
    const f = feature(registerMessagePreviews, newcomer, "newcomer")
    let ack: any
    await f.handlers.get("message:lastPreviews")!((value: unknown) => {
        ack = value
    })
    assert.deepEqual(ack.rooms, {})
    assert.deepEqual(ack.roomUnread, {})
    await pool.query("INSERT INTO messages(sender_id,room_id,content) VALUES ($1,$2,$3)", [owner, room, envelope()])
    await f.handlers.get("message:lastPreviews")!((value: unknown) => {
        ack = value
    })
    assert.equal(ack.rooms[room].from, "owner")
    assert.equal(ack.roomUnread[room], 1)
})

test("password policy rejects bcrypt truncation with Unicode and accepts 12 to 50 ASCII characters", () => {
    assert.equal(passwordPolicyError("a".repeat(12)), null)
    assert.equal(passwordPolicyError("a".repeat(50)), null)
    assert(passwordPolicyError("short"))
    assert(passwordPolicyError("я".repeat(37)))
    assert(passwordPolicyError("🔐".repeat(19)))
})

async function httpFixture(t: any) {
    const app = express()
    configureBearerAccess(app, verifyBearerAccess)
    app.locals.peerBlockEffects = createLegacyPeerBlockEffects(() => undefined)
    app.use("/admin", adminSessionRouter)
    app.use(express.json())
    app.use("/auth", emailVerificationRoutes)
    app.use("/transfer", keyTransferRoutes)
    app.use("/sessions", sessionsRoutes)
    app.use("/peers", peerSafetyRoutes)
    app.use("/admin/reports", createAdminReportRoutes({ list: listPeerReports, resolve: resolvePeerReport }))
    app.use("/voice", voiceRoutes)
    app.use("/attachments", attachmentRoutes)
    const server = app.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const address = server.address() as { port: number }
    const adminCookie = await loginAdminFixture(`http://127.0.0.1:${address.port}`)
    const request = async (path: string, body?: unknown, token?: string, headers?: Record<string, string>) => {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: "Bearer " + token } : {}),
                ...headers
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        })
        return { status: response.status, body: (await response.json().catch(() => null)) as any }
    }
    return Object.assign(request, { adminHeaders: { Cookie: adminCookie, Origin: ADMIN_TEST_ORIGIN } })
}

test("verification codes have their own purpose, expire, allow five attempts and cannot be replayed", async (t) => {
    const account = await user(),
        post = await httpFixture(t),
        code = "012345"
    await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [account.id])
    const insert = async (hash: string, expired = false) =>
        pool.query(
            "INSERT INTO email_verification_codes(user_id,code_hash,email,expires_at) VALUES ($1,$2,'test@example.test',NOW()+$3*INTERVAL '1 second') ON CONFLICT(user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,attempts=0",
            [account.id, hash, expired ? -1 : 900]
        )
    await insert(recoveryCodeHash(code, JWT_SECRET))
    assert.equal((await post("/auth/email-verification/confirm", { email: "test@example.test", code })).status, 400)
    await insert(recoveryCodeHash(code, JWT_SECRET + ":email-verification"), true)
    assert.equal((await post("/auth/email-verification/confirm", { email: "test@example.test", code })).status, 400)
    await insert(recoveryCodeHash(code, JWT_SECRET + ":email-verification"))
    for (let n = 0; n < 5; n++)
        assert.equal(
            (await post("/auth/email-verification/confirm", { email: "test@example.test", code: "000000" })).status,
            400
        )
    assert.equal((await post("/auth/email-verification/confirm", { email: "test@example.test", code })).status, 400)
    await insert(recoveryCodeHash(code, JWT_SECRET + ":email-verification"))
    assert.equal((await post("/auth/email-verification/confirm", { email: "  TEST@EXAMPLE.TEST  ", code })).status, 200)
    assert.equal((await post("/auth/email-verification/confirm", { email: "test@example.test", code })).status, 400)
    assert(
        (await pool.query("SELECT email_verified_at FROM users WHERE id=$1", [account.id])).rows[0].email_verified_at
    )
    await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [account.id])
    const legacy = "ABCDEF1234"
    await insert(recoveryCodeHash(legacy, JWT_SECRET + ":email-verification"), true)
    assert.equal((await post("/auth/email-verification/confirm", { email: "test@example.test", code: legacy })).status, 400)
    await insert(recoveryCodeHash(legacy, JWT_SECRET + ":email-verification"))
    assert.equal((await post("/auth/email-verification/confirm", { email: "test@example.test", code: legacy.toLowerCase() })).status, 200)
    assert.equal((await post("/auth/email-verification/confirm", { email: "test@example.test", code: legacy })).status, 400)
})

test("one-time encrypted key transfer is bound to the same account and consumed atomically", async (t) => {
    const account = await user(),
        otherId = await addUser("other"),
        post = await httpFixture(t)
    await issueRefreshToken(account)
    const ownToken = signUserAccessToken(account),
        otherToken = signUserAccessToken({ id: otherId, username: "other", sessionVersion: 0 })
    const payload = {
        ciphertext: Buffer.alloc(64, 17).toString("base64"),
        nonce: Buffer.alloc(24, 19).toString("base64")
    }
    const created = await post("/transfer", payload, ownToken)
    assert.equal(created.status, 200)
    assert.equal((await post(`/transfer/${created.body.id}/consume`, {}, otherToken)).status, 404)
    const responses = await Promise.all([
        post(`/transfer/${created.body.id}/consume`, {}, ownToken),
        post(`/transfer/${created.body.id}/consume`, {}, ownToken)
    ])
    assert.equal(responses.filter((response) => response.status === 200).length, 1)
    assert.deepEqual(responses.find((response) => response.status === 200)!.body, payload)
    assert.equal((await post(`/transfer/${created.body.id}/consume`, {}, ownToken)).status, 404)
})

test("session management lists only own devices and cannot revoke another account", async (t) => {
    const account = await user(),
        second = { ...account },
        post = await httpFixture(t)
    await issueRefreshToken(account)
    await issueRefreshToken(second)
    const token = signUserAccessToken(account),
        otherId = await addUser("other"),
        other = { id: otherId, username: "other", sessionVersion: 0, sessionId: undefined as string | undefined }
    await issueRefreshToken(other)
    const listed = await post("/sessions", undefined, token)
    assert.equal(listed.status, 200)
    assert.equal(listed.body.sessions.length, 2)
    assert.equal(listed.body.sessions.find((session: any) => session.current).id, account.sessionId)
    assert.equal((await post(`/sessions/${other.sessionId}/revoke`, {}, token)).status, 404)
    assert.equal((await post("/sessions/revoke-others", {}, token)).status, 400)
    await verifyUserAccessToken(signUserAccessToken(second))
    const confirmation = await sessionCode(account, null)
    assert.equal((await post("/sessions/revoke-others", confirmation, token)).status, 200)
    await verifyUserAccessToken(token)
    await assert.rejects(verifyUserAccessToken(signUserAccessToken(second)))
    await verifyUserAccessToken(signUserAccessToken(other))
})

async function sessionCode(
    account: { id: number; sessionId?: string },
    target: string | null,
    options?: { expired?: boolean; hash?: string; code?: string }
) {
    if (!account.sessionId) throw new Error("A durable requester session is required")
    const challengeId = crypto.randomUUID(),
        code = options?.code ?? "012345"
    const hash =
        options?.hash ??
        sessionRevocationCodeHash(code, challengeId, {
            userId: account.id,
            requesterSessionId: account.sessionId,
            targetSessionId: target
        })
    await pool.query(
        `INSERT INTO session_revocation_codes(id,user_id,requester_session_id,target_session_id,code_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,NOW()+$6*INTERVAL '1 second') ON CONFLICT(requester_session_id) DO UPDATE
        SET id=EXCLUDED.id,target_session_id=EXCLUDED.target_session_id,code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,attempts=0`,
        [challengeId, account.id, account.sessionId, target, hash, options?.expired ? -1 : 600]
    )
    return { challengeId, code }
}

test("device logout codes cannot be used from another session or for another action", async (t) => {
    const account = await user(),
        target = { ...account },
        third = { ...account },
        post = await httpFixture(t)
    await issueRefreshToken(account)
    await issueRefreshToken(target)
    await issueRefreshToken(third)
    const confirmation = await sessionCode(account, target.sessionId!)
    const token = signUserAccessToken(account)
    assert.equal(
        (await post(`/sessions/${target.sessionId}/revoke`, confirmation, signUserAccessToken(third))).status,
        400
    )
    assert.equal((await post("/sessions/revoke-others", confirmation, token)).status, 400)
    assert.equal((await post(`/sessions/${third.sessionId}/revoke`, confirmation, token)).status, 400)
    await verifyUserAccessToken(signUserAccessToken(target))
    assert.equal((await post(`/sessions/${target.sessionId}/revoke`, confirmation, token)).status, 200)
    await assert.rejects(verifyUserAccessToken(signUserAccessToken(target)))
    await verifyUserAccessToken(token)
    await verifyUserAccessToken(signUserAccessToken(third))
})

test("logout codes expire, stop after five wrong guesses, and reject recovery-purpose codes", async (t) => {
    const account = await user(),
        target = { ...account },
        post = await httpFixture(t)
    await issueRefreshToken(account)
    await issueRefreshToken(target)
    const token = signUserAccessToken(account),
        endpoint = `/sessions/${target.sessionId}/revoke`
    let confirmation = await sessionCode(account, target.sessionId!, { expired: true })
    assert.equal((await post(endpoint, confirmation, token)).status, 400)
    confirmation = await sessionCode(account, target.sessionId!, { hash: recoveryCodeHash("012345", JWT_SECRET) })
    assert.equal((await post(endpoint, confirmation, token)).status, 400)
    confirmation = await sessionCode(account, target.sessionId!)
    for (let i = 0; i < 5; i++)
        assert.equal((await post(endpoint, { ...confirmation, code: "000000" }, token)).status, 400)
    assert.equal((await post(endpoint, confirmation, token)).status, 400)
    await verifyUserAccessToken(signUserAccessToken(target))
    confirmation = await sessionCode(account, target.sessionId!)
    const results = await Promise.all([post(endpoint, confirmation, token), post(endpoint, confirmation, token)])
    assert.equal(results.filter((result) => result.status === 200).length, 1)
})

test("legacy emailed logout codes match only their unexpired pending challenge", async (t) => {
    const account = await user(), target = { ...account }, post = await httpFixture(t)
    await issueRefreshToken(account)
    await issueRefreshToken(target)
    const token = signUserAccessToken(account), endpoint = `/sessions/${target.sessionId}/revoke`
    const expired = await sessionCode(account, target.sessionId!, { code: "ABCDEF1234", expired: true })
    assert.equal((await post(endpoint, expired, token)).status, 400)
    const active = await sessionCode(account, target.sessionId!, { code: "ABCDEF1234" })
    assert.equal((await post(endpoint, { ...active, code: "012345" }, token)).status, 400)
    assert.equal((await post(endpoint, { ...active, code: active.code.toLowerCase() }, token)).status, 200)
    assert.equal((await post(endpoint, active, token)).status, 404)
})

test("consumed logout codes cannot be replayed after Redis loss to revoke a newer device", async (t) => {
    const account = await user(),
        target = { ...account },
        post = await httpFixture(t)
    await issueRefreshToken(account)
    await issueRefreshToken(target)
    const token = signUserAccessToken(account),
        confirmation = await sessionCode(account, null)
    assert.equal((await post("/sessions/revoke-others", confirmation, token)).status, 200)
    const later = { ...account, sessionId: undefined as string | undefined }
    await issueRefreshToken(later)
    await redis.flushdb()
    assert.equal((await post("/sessions/revoke-others", confirmation, token)).status, 400)
    await verifyUserAccessToken(token)
    await verifyUserAccessToken(signUserAccessToken(later))
})

async function sessionMailServer(t: any) {
    const messages: string[] = [],
        sockets = new Set<net.Socket>()
    let failing = false
    const previous = Object.fromEntries(
        ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD", "SMTP_TLS_SERVERNAME"].map((key) => [
            key,
            process.env[key]
        ])
    )
    const server = net
        .createServer((socket) => {
            sockets.add(socket)
            socket.on("close", () => sockets.delete(socket))
            socket.write("220 localhost test SMTP\r\n")
            let buffer = "",
                data = false,
                message = ""
            socket.on("data", (chunk) => {
                buffer += chunk.toString()
                let offset: number
                while ((offset = buffer.indexOf("\r\n")) >= 0) {
                    const line = buffer.slice(0, offset)
                    buffer = buffer.slice(offset + 2)
                    if (data) {
                        if (line === ".") {
                            messages.push(message)
                            data = false
                            message = ""
                            socket.write(failing ? "550 rejected\r\n" : "250 queued\r\n")
                        } else message += line + "\r\n"
                    } else if (/^EHLO|^HELO/.test(line)) socket.write("250-localhost\r\n250 SIZE 500000\r\n")
                    else if (line === "DATA") {
                        data = true
                        socket.write("354 Send data\r\n")
                    } else if (line === "QUIT") socket.end("221 Bye\r\n")
                    else socket.write("250 OK\r\n")
                }
            })
        })
        .listen(0, "127.0.0.1")
    await once(server, "listening")
    process.env.SMTP_HOST = "127.0.0.1"
    process.env.SMTP_PORT = String((server.address() as net.AddressInfo).port)
    process.env.SMTP_FROM = "PlayTime <noreply@example.test>"
    process.env.SMTP_USER = ""
    process.env.SMTP_PASSWORD = ""
    process.env.SMTP_TLS_SERVERNAME = ""
    t.after(async () => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    return {
        messages,
        fail(value: boolean) {
            failing = value
        }
    }
}

test("device logout sends a scoped code to the account email, throttles resend, and never returns the code", async (t) => {
    const mail = await sessionMailServer(t),
        account = await user(),
        target = { ...account },
        post = await httpFixture(t)
    await issueRefreshToken(account)
    await issueRefreshToken(target)
    const token = signUserAccessToken(account)
    const unrelatedId = await addUser("unrelated"),
        unrelated = {
            id: unrelatedId,
            username: "unrelated",
            sessionVersion: 0,
            sessionId: undefined as string | undefined
        }
    await issueRefreshToken(unrelated)
    assert.equal((await post("/sessions/revocation-code", { sessionId: unrelated.sessionId }, token)).status, 404)
    assert.equal(mail.messages.length, 0)
    const request = await post(
        "/sessions/revocation-code",
        { sessionId: target.sessionId, email: "attacker@example.test" },
        token
    )
    assert.equal(request.status, 200)
    assert.equal(mail.messages.length, 1)
    assert.match(mail.messages[0], /To: test@example.test/)
    assert(!mail.messages[0].includes("attacker@example.test"))
    const [headers, ...parts] = mail.messages[0].split("\r\n\r\n"),
        encoded = parts.join("\r\n\r\n")
    const decoded = /Content-Transfer-Encoding: base64/i.test(headers)
        ? Buffer.from(encoded.replace(/\s/g, ""), "base64").toString("utf8")
        : Buffer.from(
              encoded
                  .replace(/=\r\n/g, "")
                  .replace(/=([A-F0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))),
              "latin1"
          ).toString("utf8")
    const code = /Код подтверждения: (\d{6})/.exec(decoded)?.[1]
    assert(code)
    assert(!JSON.stringify(request.body).includes(code))
    assert.notEqual(
        (await pool.query("SELECT code_hash FROM session_revocation_codes WHERE id=$1", [request.body.challengeId]))
            .rows[0].code_hash,
        code
    )
    assert.equal((await post("/sessions/revocation-code", { allOthers: true }, token)).status, 429)
    assert.equal(
        (await post(`/sessions/${target.sessionId}/revoke`, { challengeId: request.body.challengeId, code }, token))
            .status,
        200
    )
    await verifyUserAccessToken(token)
})

test("SMTP rejection leaves sessions active and allows retry without waiting for cooldown", async (t) => {
    const mail = await sessionMailServer(t),
        account = await user(),
        target = { ...account },
        post = await httpFixture(t)
    await issueRefreshToken(account)
    await issueRefreshToken(target)
    const token = signUserAccessToken(account)
    mail.fail(true)
    assert.equal((await post("/sessions/revocation-code", { allOthers: true }, token)).status, 503)
    await verifyUserAccessToken(signUserAccessToken(target))
    assert.equal(
        (await pool.query("SELECT COUNT(*) FROM session_revocation_codes WHERE user_id=$1", [account.id])).rows[0]
            .count,
        "0"
    )
    mail.fail(false)
    assert.equal((await post("/sessions/revocation-code", { allOthers: true }, token)).status, 200)
})

test("room invitations require the owner or an appointed moderator and ownership can be transferred", async () => {
    const { owner, member, room } = await group(),
        target = await addUser("friend")
    await pool.query("INSERT INTO friendships(user_id,friend_id,status) VALUES ($1,$2,'accepted')", [member, target])
    const regular = feature(registerRooms, member, "member"),
        ownerFeature = feature(registerRooms, owner, "owner")
    let response: any
    const ack = (value: unknown) => {
        response = value
    }
    await regular.handlers.get("room:addMember")!({ roomId: room, userId: target }, ack)
    assert(response.err.includes("владелец"))
    await ownerFeature.handlers.get("room:setRole")!({ roomId: room, userId: member, role: "moderator" }, ack)
    assert(response.success)
    await regular.handlers.get("room:addMember")!({ roomId: room, userId: target }, ack)
    assert(response.success)
    await regular.handlers.get("room:transferOwnership")!({ roomId: room, userId: target }, ack)
    assert(response.err)
    await ownerFeature.handlers.get("room:transferOwnership")!({ roomId: room, userId: member }, ack)
    assert(response.success)
    assert.equal((await pool.query("SELECT created_by FROM rooms WHERE id=$1", [room])).rows[0].created_by, member)
    await ownerFeature.handlers.get("room:setRole")!({ roomId: room, userId: target, role: "moderator" }, ack)
    assert(response.err)
})

test("block ownership cannot be undone by the blocked peer; reports require an admin session and write header", async (t) => {
    const account = await user(),
        peer = await addUser("peer"),
        post = await httpFixture(t)
    const token = signUserAccessToken(account),
        peerToken = signUserAccessToken({ id: peer, username: "peer", sessionVersion: 0 })
    await pool.query("INSERT INTO friendships(user_id,friend_id,status) VALUES ($1,$2,'accepted')", [account.id, peer])
    assert.equal((await post("/peers/peer/block", {}, token)).status, 200)
    assert.equal((await pool.query("SELECT 1 FROM friendships")).rowCount, 0)
    assert.deepEqual((await post("/peers/blocked", undefined, token)).body.usernames, ["peer"])
    assert.equal((await post("/peers/tester/unblock", {}, peerToken)).status, 200)
    assert.equal((await pool.query("SELECT 1 FROM user_blocks WHERE blocker_id=$1", [account.id])).rowCount, 1)
    assert.equal((await post("/peers/peer/unblock", {}, token)).status, 200)
    assert.equal((await pool.query("SELECT 1 FROM user_blocks")).rowCount, 0)
    assert.equal((await post("/peers/peer/report", { reason: "abcd" }, token)).status, 400)
    assert.equal((await post("/peers/peer/report", { reason: "x".repeat(1001) }, token)).status, 400)
    assert.equal((await post("/peers/peer/report", { reason: "Repeated unwanted calls" }, token)).status, 200)
    const reports = await post("/admin/reports", undefined, undefined, post.adminHeaders)
    assert.equal(reports.status, 200)
    assert.equal(reports.body.reports.length, 1)
    const id = reports.body.reports[0].id
    assert.equal((await post("/admin/reports", undefined, undefined, { "X-Real-IP": "192.0.2.200" })).status, 401)
    assert.equal((await post(`/admin/reports/${id}/resolve`, {}, undefined, post.adminHeaders)).status, 403)
    assert.equal((await post(`/admin/reports/${id}/resolve`, {}, undefined, { ...post.adminHeaders, "X-PlayTime-Admin": "1" })).status, 200)
    assert((await post("/admin/reports", undefined, undefined, post.adminHeaders)).body.reports[0].resolved_at)
})

test("late room members cannot download pre-join encrypted media even with its storage key", async (t) => {
    const { owner, newcomer, room, oldId } = await group(),
        post = await httpFixture(t),
        token = signUserAccessToken({ id: newcomer, username: "newcomer", sessionVersion: 0 })
    await pool.query(
        "UPDATE messages SET voice_storage_key='old-voice',attachment_storage_key='old-file' WHERE id=$1",
        [oldId]
    )
    assert.equal((await post("/voice/old-voice", undefined, token)).status, 403)
    assert.equal((await post("/attachments/old-file", undefined, token)).status, 403)
})

test("release retention preserves latest, previous three, recent rows and shared updater files", async (t) => {
    const os = await import("node:os"),
        path = await import("node:path"),
        { registerRelease, patchRelease } = await import("../releases/releaseService.js"),
        { pruneOldReleases } = await import("../releases/retention.js")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-retention-")),
        old = process.env.RELEASES_DIR
    process.env.RELEASES_DIR = root
    t.after(() => {
        process.env.RELEASES_DIR = old
        fs.rmSync(root, { recursive: true, force: true })
    })
    await pool.query("DELETE FROM app_releases")
    fs.mkdirSync(path.join(root, "darwin"))
    const ids = []
    for (let index = 0; index < 7; index++) {
        const filename = "release-" + index + ".dmg",
            file = path.join(root, "darwin", filename)
        fs.writeFileSync(file, "test-artifact")
        const row = await registerRelease({
            version: "0.0." + index,
            platform: "darwin",
            filename,
            updateFilename: index < 2 ? "shared.zip" : null,
            fileSize: 13,
            sha512: "test"
        })
        ids.push(row.id)
        await pool.query("UPDATE app_releases SET created_at=NOW()-($2*INTERVAL '1 day') WHERE id=$1", [
            row.id,
            60 - index
        ])
    }
    fs.writeFileSync(path.join(root, "darwin", "shared.zip"), "shared")
    await patchRelease(ids[0], { isLatest: true })
    await pool.query("UPDATE app_releases SET created_at=NOW() WHERE id=$1", [ids[1]])
    assert.equal(await pruneOldReleases(), 3)
    assert(fs.existsSync(path.join(root, "darwin", "release-0.dmg")))
    assert(fs.existsSync(path.join(root, "darwin", "shared.zip")))
    assert(!fs.existsSync(path.join(root, "darwin", "release-2.dmg")))
    const latest = await pool.query("SELECT id FROM app_releases WHERE is_latest=TRUE")
    assert.equal(latest.rows[0].id, ids[0])
    assert.equal(await patchRelease(ids[2], { isLatest: true }), null)
    assert.equal((await pool.query("SELECT id FROM app_releases WHERE is_latest=TRUE")).rows[0].id, ids[0])
    await pool.query("DELETE FROM app_releases")
})

test("room-admission keeps the voice cap under simultaneous joins", async () => {
    const { owner, member, newcomer, room } = await group()
    const ids = [owner, member, newcomer]
    for (let i = 0; i < 7; i++) {
        const id = await addUser("joining" + i)
        ids.push(id)
        await pool.query("INSERT INTO room_members(room_id,user_id) VALUES($1,$2)", [room, id])
    }
    const active = new Set<FeatureSocket>()
    const target: FeatureRooms = {
        fetchSockets: async () => [...active],
        emit: () => true,
        disconnectSockets() {},
        socketsLeave() {}
    }
    const io: FeatureIo = { in: () => target, to: () => target, serverSideEmit: () => true }
    const participants = ids.map((id) => {
        const handlers = new Map<string, FeatureListener>()
        const user = { id, username: "peer" + id }
        const socket: FeatureSocket = {
            id: String(id),
            data: {},
            handshake: { auth: {} },
            rooms: new Set(),
            user,
            nsp: { server: io, in: io.in },
            on(event, handler) {
                handlers.set(event, handler)
            },
            emit: () => true,
            to: io.to,
            join: async (name: string) => {
                await new Promise((r) => setTimeout(r, 15))
                socket.rooms.add(name)
                active.add(socket)
            },
            leave(name) {
                socket.rooms.delete(name)
                active.delete(socket)
            }
        }
        registerPartyRoomsSocket({ io, socket, user }, localPartyServices)
        const enter = handlers.get("room:enter")
        assert.ok(enter)
        return new Promise<RoomEnterAck>((resolve) => {
            void enter({ roomId: room }, resolve)
        })
    })
    const replies = await Promise.all(participants)
    assert.equal(replies.filter((reply) => reply.success).length, 5)
    assert.equal(active.size, 5)
    assert.equal(replies.filter((reply) => reply.err).length, 5)
})
