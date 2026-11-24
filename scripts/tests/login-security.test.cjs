const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { createRequire } = require("node:module")
const { loadAuthModules, findRouteHandler } = require("../fixtures/auth-module-loader.cjs")

const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const bcrypt = backendRequire("bcrypt")
const express = backendRequire("express")
require("tsx/cjs")
const passwordPolicy = require("../../apps/shared/auth/passwordPolicy.ts")
const password = "correct-account-password"
const passwordHash = bcrypt.hashSync(password, 12)
const replacementPassword = "replacement-account-password"
const replacementHash = bcrypt.hashSync(replacementPassword, 12)
const email = "member@example.test"
const failed = { status: 401, body: { error: "Неверный email или пароль." } }
function fixture(options = {}) {
    const state = {
        exists: options.exists !== false,
        version: 7,
        hash: options.hash ?? passwordHash,
        compares: [],
        issued: [],
        signed: [],
        events: [],
        values: new Map()
    }
    const account = {
        id: 42,
        username: "member",
        email,
        password_hash: state.hash,
        is_blocked: options.blocked === true,
        email_verified_at: options.unverified ? null : new Date()
    }
    if (options.locked) state.values.set("acct_locked:42", "1")
    const redis = {
        async ttl(key) {
            if (key === "acct_locked:42") state.events.push("account-lock")
            return state.values.has(key) ? 3600 : -1
        },
        async incr(key) {
            const count = Number(state.values.get(key) ?? 0) + 1
            state.values.set(key, count)
            return count
        },
        async expire() {},
        async set(key, value) { state.values.set(key, value) },
        async del(key) { state.values.delete(key) }
    }
    const replacements = {
        express,
        "node:crypto": require("node:crypto"),
        bcrypt: {
            async compare(value, hash) {
                state.events.push("compare")
                state.compares.push({ value, hash })
                options.beforeCompare?.(state)
                return bcrypt.compare(value, hash)
            }
        },
        "apps/auth-api/auth/emailVerification.ts": {},
        "apps/auth-api/auth/revokeDeviceSession.ts": {},
        "apps/auth-api/services/recoveryMail.ts": {},
        "apps/shared/auth/passwordPolicy.ts": passwordPolicy,
        "apps/shared/config.ts": {
            redis,
            pool: {
                async query(sql, args) {
                    if (sql === "SELECT * FROM users WHERE email=$1") {
                        assert.equal(args[0], email)
                        return { rows: state.exists ? [{ ...account }] : [] }
                    }
                    if (sql === "SELECT password_hash FROM users WHERE id = $1") {
                        state.events.push("read-hash")
                        assert.equal(args[0], account.id)
                        return { rows: state.exists ? [{ password_hash: state.hash }] : [] }
                    }
                    throw new Error(`Unexpected query: ${sql}`)
                }
            }
        },
        "apps/auth-api/http/authRateLimits.ts": {
            createAuthRateLimiters: () => Object.fromEntries(
                ["loginRegisterLimiter", "tokenValidLimiter", "refreshLimiter", "revokeLimiter"].map(name => [name, (_req, _res, next) => next()])
            )
        },
        "apps/auth-api/auth/sessionVersion.ts": {
            async getSessionVersion(id) {
                assert.equal(id, account.id)
                state.events.push("version-snapshot")
                const snapshot = state.version
                options.afterVersionSnapshot?.(state)
                return snapshot
            }
        },
        "apps/auth-api/auth/index.ts": {
            async issueRefreshToken(session, metadata) {
                state.issued.push({ session: { ...session }, metadata })
                if (session.sessionVersion !== state.version) throw new Error("Session revoked")
                session.sessionId = "test-device-session"
                return "test-refresh-token"
            },
            signUserAccessToken(session) {
                state.signed.push({ ...session })
                return "test-access-token"
            },
            getAccessTokenTtlSeconds: () => 900
        }
    }
    const load = loadAuthModules(replacements, { error() {} })
    const router = load("apps/auth-api/routes/auth.ts").default
    const handler = findRouteHandler(router, "/login")
    return {
        state,
        async login(body = {}) {
            const response = {
                status: 200,
                body: undefined
            }
            const res = {
                status(value) { response.status = value; return this },
                json(value) { response.body = value; return this }
            }
            await handler({
                body: { email, password: "wrong-account-password", ...body },
                ip: "192.0.2.1",
                socket: {},
                get: name => ({ "user-agent": "Test browser", "x-playtime-device": "Test device" })[name]
            }, res)
            return response
        }
    }
}

test("wrong passwords use one cost-12 bcrypt comparison and the same response for every account state", async () => {
    for (const options of [{ exists: false }, {}, { blocked: true }, { locked: true }, { unverified: true }]) {
        const f = fixture(options)
        assert.deepEqual(await f.login(), failed)
        assert.equal(f.state.compares.length, 1)
        assert.equal(bcrypt.getRounds(f.state.compares[0].hash), 12)
        assert.equal(f.state.values.get(`login_attempts:${email}:192.0.2.1`), 1)
        assert(!f.state.events.includes("account-lock"))
        assert.equal(f.state.issued.length, 0)
    }
})

test("knowing the public dummy password cannot authenticate a missing account", async () => {
    const f = fixture({ exists: false })
    assert.deepEqual(await f.login({ password: "playtime-public-dummy-password" }), failed)
    assert.equal(f.state.compares.length, 1)
    assert.equal(f.state.issued.length, 0)
    assert.equal(f.state.signed.length, 0)
})

test("blocked, locked and unverified states are disclosed only after the correct password", async () => {
    for (const [options, expected] of [
        [{ blocked: true }, { status: 403, body: { error: "Учётная запись заблокирована администратором." } }],
        [{ locked: true }, { status: 429, body: { error: "Слишком много неудачных попыток входа. Повторите позже." } }],
        [{ unverified: true }, { status: 403, body: { error: "Подтвердите почту кодом из письма", verificationRequired: true } }]
    ]) {
        const f = fixture(options)
        assert.deepEqual(await f.login({ password }), expected)
        assert.equal(f.state.compares.length, 1)
        assert.equal(f.state.issued.length, 0)
        assert.equal(f.state.signed.length, 0)
    }
})

test("five wrong attempts throttle missing, active, blocked and locked accounts equally", async () => {
    for (const options of [{ exists: false }, {}, { blocked: true }, { locked: true }]) {
        const f = fixture(options)
        for (let i = 0; i < 4; i++) assert.deepEqual(await f.login(), failed)
        const throttled = { status: 429, body: { error: "Слишком много неудачных попыток входа. Повторите позже." } }
        assert.deepEqual(await f.login(), throttled)
        assert.deepEqual(await f.login(), throttled)
        assert.equal(f.state.compares.length, 5)
        assert.equal(f.state.issued.length, 0)
    }
})

test("a valid login preserves session version, device metadata and the existing response", async () => {
    const f = fixture()
    const response = await f.login({ email: " MEMBER@EXAMPLE.TEST ", password })
    assert.deepEqual(response, {
        status: 200,
        body: {
            token: "test-access-token",
            refreshToken: "test-refresh-token",
            expiresIn: 900,
            user: { id: 42, username: "member", email, isGuest: false, registrationPending: false }
        }
    })
    assert.deepEqual(f.state.issued, [{
        session: { id: 42, username: "member", sessionVersion: 7 },
        metadata: { userAgent: "Test browser", deviceName: "Test device" }
    }])
    assert.equal(f.state.signed[0].sessionId, "test-device-session")
    assert.deepEqual(f.state.events, ["version-snapshot", "read-hash", "compare", "account-lock"])
})

test("existing passwords shorter than the registration minimum remain usable", async () => {
    const legacyPassword = "legacy"
    const f = fixture({ hash: bcrypt.hashSync(legacyPassword, 12) })
    assert.equal((await f.login({ password: legacyPassword })).status, 200)
    assert.equal(f.state.issued.length, 1)
})

test("a password changed after the version snapshot is read freshly before comparison", async () => {
    const f = fixture({
        afterVersionSnapshot(state) { state.hash = replacementHash; state.version++ }
    })
    assert.deepEqual(await f.login({ password }), failed)
    assert.equal(f.state.compares[0].hash, replacementHash)
    assert.deepEqual(f.state.events, ["version-snapshot", "read-hash", "compare"])
    assert.equal(f.state.issued.length, 0)
})

test("an account deleted before the fresh hash read still takes the dummy bcrypt path", async () => {
    const f = fixture({ afterVersionSnapshot(state) { state.exists = false } })
    assert.deepEqual(await f.login({ password }), failed)
    assert.equal(f.state.compares.length, 1)
    assert.notEqual(f.state.compares[0].hash, passwordHash)
    assert.equal(bcrypt.getRounds(f.state.compares[0].hash), 12)
    assert.equal(f.state.issued.length, 0)
})

test("revocation during password comparison cannot issue an access token for a newer version", async () => {
    const f = fixture({ beforeCompare(state) { state.version++ } })
    assert.equal((await f.login({ password })).status, 500)
    assert.equal(f.state.issued[0].session.sessionVersion, 7)
    assert.equal(f.state.signed.length, 0)
})
