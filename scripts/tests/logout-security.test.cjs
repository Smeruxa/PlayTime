const { test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const path = require("node:path")
const { createRequire } = require("node:module")
const { loadAuthModules, findRouteHandler } = require("../fixtures/auth-module-loader.cjs")

const root = path.resolve(__dirname, "../..")
const secret = "isolated-logout-test-secret-at-least-32-characters"
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const jwt = backendRequire("jsonwebtoken")

function fixture() {
    const sessions = new Map(), blacklisted = new Set(), disconnected = []
    let failNext = false
    const pool = { async connect() { return { query: pool.query, release() {} } }, async query(sql, args = []) {
        if (failNext) { failNext = false; throw new Error("database unavailable") }
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] }
        if (sql.startsWith("SELECT id FROM users")) return { rows: [{ id: args[0] }] }
        if (sql.startsWith("SELECT username, is_guest")) return { rows: [{ username: `user${args[0]}`, is_guest: false }] }
        if (sql.startsWith("SELECT id, user_id")) return { rows: [...sessions].filter(([,s]) => s.hash === args[0]).map(([id,s]) => ({ id, user_id: s.uid })) }
        if (sql.startsWith("INSERT INTO auth_sessions")) {
            const [id, uid, hash, version] = args
            if (version !== 0 || sessions.get(id)?.revoked) return { rows: [] }
            sessions.set(id, { uid, hash, version, revoked: false })
            return { rows: [{ id }] }
        }
        if (sql.startsWith("UPDATE auth_sessions s SET")) {
            const found = [...sessions].find(([, s]) => s.hash === args[0] && !s.revoked)
            if (!found) return { rows: [] }
            const [id, s] = found
            s.hash = null
            return { rows: [{ id: s.uid, username: `user${s.uid}`, session_version: s.version, session_id: id }] }
        }
        if (sql.startsWith("UPDATE auth_sessions SET")) {
            for (const [id, s] of sessions) {
                const matches = /WHERE id\s*=\s*\$1 AND user_id\s*=\s*\$2/.test(sql)
                    ? id === args[0] && s.uid === args[1] && !s.revoked
                    : s.hash === args[0]
                if (matches) { s.revoked = true; s.hash = null }
            }
            return { rows: sql.includes("RETURNING id") ? [{ id: args[0] }] : [] }
        }
        if (sql.startsWith("SELECT 1 FROM users u")) {
            const [uid, version, jti, sid] = args, s = sessions.get(sid)
            return { rows: version === 0 && !blacklisted.has(jti) && (!sid || (s?.uid === uid && !s.revoked)) ? [{}] : [] }
        }
        if (sql.startsWith("INSERT INTO revoked_access_tokens")) { blacklisted.add(args[0]); return { rows: [] } }
        throw new Error(`Unexpected query: ${sql}`)
    } }
    const pass = (_req, _res, next) => next()
    const load = loadAuthModules({
        "apps/shared/config.ts": { pool, JWT_SECRET: secret, redis: {} },
        "apps/auth-api/http/authRateLimits.ts": {
            createAuthRateLimiters: () => ({ loginRegisterLimiter: pass, tokenValidLimiter: pass, refreshLimiter: pass, revokeLimiter: pass })
        }
    })
    const auth = load("apps/auth-api/auth/index.ts")
    const router = load("apps/auth-api/routes/auth.ts").default
    const route = findRouteHandler(router, "/revoke")
    return {
        auth, sessions, disconnected, failNextQuery() { failNext = true },
        async device(uid = 1) {
            const user = { id: uid, username: `user${uid}`, sessionVersion: 0 }
            const refreshToken = await auth.issueRefreshToken(user)
            return { user, token: auth.signUserAccessToken(user), refreshToken }
        },
        async logout(body) {
            const response = { status: 200, body: undefined }
            await route({ body, app: { get: () => ({ in: room => ({ disconnectSockets: () => disconnected.push(room) }) }) } }, {
                status(value) { response.status = value; return this },
                json(value) { response.body = value; return this }
            })
            return response
        }
    }
}

test("logout revokes a device whose refresh response was already rotated and preserves other devices", async () => {
    const f = fixture(), first = await f.device(), other = await f.device()
    const rotated = await f.auth.takeRefreshToken(first.refreshToken)
    const delayedRefresh = await f.auth.issueRefreshToken(rotated)
    const delayedAccess = f.auth.signUserAccessToken(rotated)
    assert.deepEqual(await f.logout({ token: first.token, refreshToken: first.refreshToken }), { status: 200, body: { ok: true } })
    await assert.rejects(f.auth.verifyUserAccessToken(delayedAccess))
    assert.equal(await f.auth.takeRefreshToken(delayedRefresh), null)
    assert(f.sessions.get(first.user.sessionId).revoked)
    assert(f.disconnected.includes(`auth:device:${first.user.sessionId}`))
    assert(!f.disconnected.includes(`auth:device:${other.user.sessionId}`))
    await f.auth.verifyUserAccessToken(other.token)
    assert(await f.auth.takeRefreshToken(other.refreshToken))
})

test("logout during refresh consumption prevents an in-flight rotation from reviving the device", async () => {
    const f = fixture(), first = await f.device()
    const inFlight = await f.auth.takeRefreshToken(first.refreshToken)
    assert(inFlight)
    await f.logout({ token: first.token, refreshToken: first.refreshToken })
    await assert.rejects(f.auth.issueRefreshToken(inFlight), /Session revoked/)
    await assert.rejects(f.auth.verifyUserAccessToken(first.token))
})

test("repeated logout is idempotent and does not revoke another device", async () => {
    const f = fixture(), first = await f.device(), other = await f.device()
    for (let i = 0; i < 2; i++) {
        assert.deepEqual(await f.logout({ token: first.token, refreshToken: first.refreshToken }), { status: 200, body: { ok: true } })
    }
    await assert.rejects(f.auth.verifyUserAccessToken(first.token))
    await f.auth.verifyUserAccessToken(other.token)
})

test("a valid refresh token still logs out the device when its access token has expired", async () => {
    const f = fixture(), first = await f.device(), other = await f.device()
    const expired = jwt.sign({ id: 1, username: "user1", sv: 0, sid: first.user.sessionId }, secret, {
        algorithm: "HS256", expiresIn: -1, jwtid: crypto.randomUUID()
    })
    assert.equal((await f.logout({ token: expired, refreshToken: first.refreshToken })).status, 200)
    await assert.rejects(f.auth.verifyUserAccessToken(first.token))
    assert.equal(await f.auth.takeRefreshToken(first.refreshToken), null)
    await f.auth.verifyUserAccessToken(other.token)
})

test("invalid tokens and an untrusted sessionId in the body cannot revoke a device", async () => {
    const f = fixture(), other = await f.device()
    assert.equal((await f.logout({ token: "invalid", refreshToken: "invalid", sessionId: other.user.sessionId })).status, 200)
    await f.auth.verifyUserAccessToken(other.token)
    assert(await f.auth.takeRefreshToken(other.refreshToken))
})

test("legacy access tokens without a device session retain access-token-only logout", async () => {
    const f = fixture(), other = await f.device()
    const legacy = f.auth.signUserAccessToken({ id: 1, username: "user1", sessionVersion: 0 })
    await f.logout({ token: legacy })
    await assert.rejects(f.auth.verifyUserAccessToken(legacy))
    await f.auth.verifyUserAccessToken(other.token)
    assert.equal(f.disconnected.length, 1)
    assert(f.disconnected[0].startsWith("auth:access:"))
})

test("unexpected storage failure returns retryable 503 instead of claiming logout succeeded", async () => {
    const f = fixture(), device = await f.device()
    f.failNextQuery()
    const response = await f.logout({ token: device.token, refreshToken: device.refreshToken })
    assert.equal(response.status, 503)
    assert.equal(f.sessions.get(device.user.sessionId).revoked, false)
    assert.equal((await f.logout({ token: device.token, refreshToken: device.refreshToken })).status, 200)
    assert.equal(f.sessions.get(device.user.sessionId).revoked, true)
})

test("hash-only logout disconnects a registered session without retaining its authentication credential", async () => {
    const f = fixture(), device = await f.device(), other = await f.device()
    const hash = crypto.createHash("sha256").update(device.refreshToken).digest("hex")
    assert.equal((await f.logout({ refreshTokenHash: hash })).status, 200)
    assert.equal(f.sessions.get(device.user.sessionId).revoked, true)
    assert.equal(f.sessions.get(other.user.sessionId).revoked, false)
    assert(f.disconnected.includes(`auth:device:${device.user.sessionId}`))
})
