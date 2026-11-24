const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { once } = require("node:events")
const { createRequire } = require("node:module")
const { loadAuthModules } = require("../fixtures/auth-module-loader.cjs")
require("tsx/cjs")

const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const express = backendRequire("express")
const bcrypt = backendRequire("bcrypt")
const recoveryCode = require("../../apps/auth-api/auth/recoveryCode.ts")
const secret = "isolated-guest-auth-test-secret"
const code = "012345"
class AuthRetryError extends Error { constructor(status, message) { super(message); this.status = status } }

async function fixture(t, options = {}) {
    const state = { users: [], issued: [], emails: [], values: new Map(), codes: new Map(), recoveryCodes: new Map(), nextId: 1, mutations: [] }
    const pool = {
        async query(sql, args = []) {
            if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] }
            if (sql.startsWith("INSERT INTO users")) {
                if (state.users.some(user => user.username === args[0] || user.email === args[1])) throw Object.assign(new Error("duplicate"), { code: "23505" })
                const user = { id: state.nextId++, username: args[0], email: args[1], password_hash: args[2], is_guest: true, guest_registration_pending: false, is_blocked: false, email_verified_at: null, auth_version: 0, friends: [17], messages: [20], dm_public_key: "preserved-key" }
                state.users.push(user)
                return { rows: [{ ...user }] }
            }
            if (sql.startsWith("SELECT c.*")) {
                const pending = state.codes.get(args[0])
                return { rows: pending?.email === args[1] ? [{ ...pending }] : [] }
            }
            if (sql.startsWith("SELECT id FROM users WHERE email=")) return { rows: state.users.filter(user => user.email === args[0] && !user.is_blocked && !user.email_verified_at).map(user => ({ id: user.id })) }
            if (sql.startsWith("UPDATE email_verification_codes")) { state.codes.get(args[0]).attempts++; return { rows: [] } }
            if (sql.startsWith("DELETE FROM email_verification_codes")) { state.codes.delete(args[0]); return { rows: [] } }
            if (sql.startsWith("DELETE FROM password_recovery")) { state.recoveryCodes.delete(args[0]); return { rows: [] } }
            if (sql.startsWith("UPDATE users SET email_verified_at")) {
                const user = state.users.find(user => user.id === args[0])
                user.email_verified_at = new Date()
                user.is_guest = false
                user.guest_registration_pending = false
                return { rows: [] }
            }
            if (sql.startsWith("UPDATE users SET email=")) {
                if (sql.startsWith("UPDATE users SET email=$1\n")) {
                    await options.beforeEmailWrite?.(state)
                    const user = state.users.find(user => user.id === args[1] && user.email === args[2] && user.password_hash === args[3] && user.is_guest && user.guest_registration_pending && !user.email_verified_at && !user.is_blocked && user.auth_version === args[4] && !user.revoked && args[7] > Date.now() / 1000)
                    if (!user) return { rows: [] }
                    if (state.users.some(other => other.id !== user.id && other.email === args[0])) throw Object.assign(new Error("duplicate"), { code: "23505" })
                    user.email = args[0]
                    state.mutations.push(user.id)
                    return { rows: [{ ...user }] }
                }
                await options.beforeUpgradeWrite?.(state)
                const user = state.users.find(user => user.id === args[2] && user.is_guest && !user.guest_registration_pending && !user.is_blocked && user.auth_version === args[3] && !user.revoked && args[6] > Date.now() / 1000)
                if (!user) return { rows: [] }
                if (state.users.some(other => other.id !== user.id && other.email === args[0])) throw Object.assign(new Error("duplicate"), { code: "23505" })
                user.email = args[0]
                user.password_hash = args[1]
                user.guest_registration_pending = true
                state.mutations.push(user.id)
                return { rows: [{ ...user }] }
            }
            if (sql.startsWith("SELECT password_hash")) return { rows: state.users.filter(user => user.id === args[0]).map(user => ({ password_hash: user.password_hash })) }
            if (sql.startsWith("SELECT * FROM users WHERE email=")) return { rows: state.users.filter(user => user.email === args[0]).map(user => ({ ...user })) }
            if (sql.startsWith("SELECT id, username, email")) {
                return { rows: state.users.filter(user => user.id === args[0] && (!sql.includes("AND is_blocked=FALSE") || !user.is_blocked) && (!sql.includes("auth_version=$2") || user.auth_version === args[1])).map(user => ({ ...user })) }
            }
            if (sql.startsWith("SELECT id,email FROM users")) return { rows: state.users.filter(user => user.email === args[0] && !user.email_verified_at && !user.is_blocked && (!user.is_guest || user.guest_registration_pending)).map(user => ({ ...user })) }
            throw new Error(`Unexpected query: ${sql}`)
        },
        async connect() { return { query: pool.query, release() {} } }
    }
    const redis = {
        async ttl(key) { return state.values.has(key) ? 60 : -1 },
        async set(key, value, _ex, _seconds, nx) { if (nx && state.values.has(key)) return null; state.values.set(key, value); return "OK" },
        async del(key) { state.values.delete(key) },
        async eval(_script, _count, key, value) { if (state.values.get(key) === value) state.values.delete(key) },
        async incr(key) { const value = Number(state.values.get(key) || 0) + 1; state.values.set(key, value); return value },
        async expire() {}
    }
    const replacements = {
        express, bcrypt,
        "apps/shared/config.ts": { pool, redis, JWT_SECRET: secret },
        "apps/shared/auth/passwordPolicy.ts": require("../../apps/shared/auth/passwordPolicy.ts"),
        "apps/auth-api/auth/recoveryCode.ts": recoveryCode,
        "apps/auth-api/auth/emailCodeLimits.ts": { createEmailCodeLimits: () => ({ async canTry() { return true }, async recordFailure() {} }) },
        "apps/auth-api/auth/revokeDeviceSession.ts": {},
        "apps/auth-api/http/authRateLimits.ts": { createAuthRateLimiters: () => Object.fromEntries(["loginRegisterLimiter", "tokenValidLimiter", "refreshLimiter", "revokeLimiter"].map(name => [name, (_req, _res, next) => next()])) },
        "apps/auth-api/services/recoveryMail.ts": { isRecoveryMailConfigured: () => options.mail !== false },
        "apps/auth-api/auth/emailVerification.ts": { async sendEmailVerification(id, email) {
            const sentCode = state.emails.length === 0 ? code : "ABCDEF" + state.emails.length.toString(16).padStart(4, "0")
            state.emails.push({ id, email, code: sentCode })
            state.codes.set(id, { user_id: id, email, attempts: 0, code_hash: recoveryCode.recoveryCodeHash(sentCode, secret + ":email-verification") })
        } },
        "apps/auth-api/auth/sessionVersion.ts": { async getSessionVersion(id) { return state.users.find(user => user.id === id)?.auth_version || 0 } },
        "apps/auth-api/auth/index.ts": {
            AuthRetryError,
            validAuthRequestKey: value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
            async createGuestSession(username, _requestKey, _metadata, createCredentials) {
                const { email, passwordHash } = await createCredentials()
                const user = (await pool.query("INSERT INTO users", [username, email, passwordHash])).rows[0]
                const session = { id: user.id, username, sessionVersion: user.auth_version }
                state.issued.push(session)
                return { user, session, refreshToken: `refresh-${user.id}` }
            },
            async rotateRefreshSession(token, _requestKey, assertAccountAllowed) {
                const id = Number(token.replace("refresh-", ""))
                const user = state.users.find(user => user.id === id)
                if (!user) throw new AuthRetryError(401, "Invalid refresh")
                await assertAccountAllowed(id)
                return { user: { ...user }, session: { id, username: user.username, sessionVersion: user.auth_version }, refreshToken: token }
            },
            async verifyUserAccessToken(token) {
                const match = /^access-(\d+)$/.exec(token)
                const user = match && state.users.find(user => user.id === Number(match[1]) && !user.is_blocked)
                if (!user || user.revoked) throw new Error("invalid access")
                return { id: user.id, username: user.username, sessionVersion: user.auth_version, jti: "test-jti", exp: Math.floor(Date.now() / 1000) + 900 }
            },
            async issueRefreshToken(session) { state.issued.push({ ...session }); return `refresh-${session.id}` },
            signUserAccessToken(session) { return `access-${session.id}` },
            getAccessTokenTtlSeconds: () => 900,
            REFRESH_TOKEN_HEX_LENGTH: 64,
            async takeRefreshToken(token) { const id = Number(token.replace("refresh-", "")); const user = state.users.find(user => user.id === id); return user ? { id, sessionVersion: user.auth_version } : null }
        }
    }
    const app = express()
    app.use(express.json())
    const load = loadAuthModules(replacements)
    for (const file of ["auth", "emailVerification"]) {
        app.use("/auth", load(`apps/auth-api/routes/${file}.ts`).default)
    }
    const server = app.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(() => new Promise(resolve => server.close(resolve)))
    const post = async (route, body, token) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
        return { status: response.status, body: await response.json() }
    }
    return { state, post, guest: (username = "guest_one") => post("guest", { username }), unlock: () => state.values.clear() }
}

test("nickname-only entry creates a private credential and never signs in to an occupied nickname", async t => {
    const f = await fixture(t, { mail: false })
    const first = await f.guest()
    assert.equal(first.status, 200)
    assert.deepEqual(first.body.user, { id: 1, username: "guest_one", email: null, isGuest: true, registrationPending: false })
    assert.match(f.state.users[0].password_hash, /^\$2b\$12\$/)
    assert.equal(await bcrypt.compare("guest_one", f.state.users[0].password_hash), false)
    assert.match(f.state.users[0].email, /^guest-[a-f0-9]{48}@guest\.playtime\.invalid$/)
    assert.equal((await f.guest("guest_two")).status, 429)
    f.unlock()
    assert.equal((await f.guest()).status, 409)
    assert.equal(f.state.users.length, 1)
    assert.equal(f.state.issued.length, 1)
    assert.equal(f.state.emails.length, 0)
    assert.equal((await f.post("tokenValid", { token: first.body.token })).body.user.email, null)
    assert.equal((await f.post("refresh", { refreshToken: first.body.refreshToken })).body.user.isGuest, true)
})

test("malformed retry proofs are rejected before reserving a nickname or consuming a refresh", async t => {
    const f = await fixture(t)
    for (const requestKey of ["short", "A".repeat(64), null, {}, "0".repeat(65)]) {
        assert.equal((await f.post("guest", { username: "guest_one", requestKey })).status, 400)
        assert.equal((await f.post("refresh", { refreshToken: "refresh-1", requestKey })).status, 400)
    }
    assert.equal(f.state.users.length, 0)
    assert.equal(f.state.values.size, 0)
    assert.equal((await f.guest()).status, 200)
})

test("upgrade requires the guest session and keeps identity and data through email confirmation", async t => {
    const f = await fixture(t)
    const guest = (await f.guest()).body
    const input = { email: " MEMBER@EXAMPLE.TEST ", password: "registered-account-password", id: 999 }
    assert.equal((await f.post("guest/upgrade", input)).status, 401)
    assert.equal((await f.post("guest/upgrade", input, "access-999")).status, 401)
    const upgraded = await f.post("guest/upgrade", input, guest.token)
    assert.equal(upgraded.status, 200)
    assert.equal(upgraded.body.verificationRequired, true)
    assert.deepEqual(upgraded.body.user, { id: 1, username: "guest_one", email: "member@example.test", isGuest: true, registrationPending: true })
    assert.equal((await f.post("login", { email: "member@example.test", password: input.password })).status, 403)
    assert.equal((await f.post("email-verification/confirm", { email: "member@example.test", code: "0000000000" })).status, 400)
    assert.equal(f.state.users[0].is_guest, true)
    assert.equal((await f.post("email-verification/confirm", { email: "member@example.test", code })).status, 200)
    const restored = (await f.post("tokenValid", { token: guest.token })).body.user
    assert.deepEqual(restored, { id: 1, username: "guest_one", email: "member@example.test", isGuest: false, registrationPending: false })
    assert.equal((await f.post("refresh", { refreshToken: guest.refreshToken })).body.user.isGuest, false)
    assert.equal((await f.post("login", { email: "member@example.test", password: input.password })).body.user.id, 1)
    assert.equal((await f.post("email-verification/confirm", { email: "member@example.test", code })).status, 400)
    assert.equal((await f.post("guest/upgrade", input, guest.token)).status, 409)
    assert.deepEqual(f.state.users[0].friends, [17])
    assert.deepEqual(f.state.users[0].messages, [20])
    assert.equal(f.state.users[0].dm_public_key, "preserved-key")
})

test("pending registration retries cannot replace email or password", async t => {
    const f = await fixture(t)
    const guest = (await f.guest()).body
    const input = { email: "member@example.test", password: "registered-account-password" }
    assert.equal((await f.post("guest/upgrade", input, guest.token)).status, 200)
    const passwordHash = f.state.users[0].password_hash
    assert.equal((await f.post("guest/upgrade", { ...input, password: "different-account-password" }, guest.token)).status, 200)
    assert.equal((await f.post("guest/upgrade", { ...input, email: "other@example.test" }, guest.token)).status, 409)
    assert.equal(f.state.users[0].email, input.email)
    assert.equal(f.state.users[0].password_hash, passwordHash)
    assert.equal(f.state.mutations.length, 1)
})

test("simultaneous upgrades commit only one set of credentials", async t => {
    const f = await fixture(t)
    const guest = (await f.guest()).body
    const responses = await Promise.all(["first", "second"].map(name => f.post("guest/upgrade", { email: `${name}@example.test`, password: `${name}-account-password` }, guest.token)))
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409])
    assert.equal(f.state.mutations.length, 1)
    const winner = responses.find(response => response.status === 200).body.user.email.split("@")[0]
    assert.equal(await bcrypt.compare(`${winner}-account-password`, f.state.users[0].password_hash), true)
})

test("revocation during password hashing prevents the upgrade write", async t => {
    const f = await fixture(t, { beforeUpgradeWrite: state => { state.users[0].auth_version++ } })
    const guest = (await f.guest()).body
    const email = f.state.users[0].email
    assert.equal((await f.post("guest/upgrade", { email: "member@example.test", password: "registered-account-password" }, guest.token)).status, 409)
    assert.equal(f.state.users[0].email, email)
    assert.equal(f.state.users[0].guest_registration_pending, false)
})

test("logging out a device during password hashing prevents the upgrade write", async t => {
    const f = await fixture(t, { beforeUpgradeWrite: state => { state.users[0].revoked = true } })
    const guest = (await f.guest()).body
    const email = f.state.users[0].email
    assert.equal((await f.post("guest/upgrade", { email: "member@example.test", password: "registered-account-password" }, guest.token)).status, 409)
    assert.equal(f.state.users[0].email, email)
    assert.equal(f.state.users[0].guest_registration_pending, false)
})

test("invalid input, occupied email and SMTP outage preserve the usable guest", async t => {
    const f = await fixture(t)
    for (const username of [null, 1, "ab", "two names", "long_long_long_long"]) assert.equal((await f.guest(username)).status, 400)
    const guest = (await f.guest()).body
    const email = f.state.users[0].email
    assert.equal((await f.post("guest/upgrade", { email: "bad", password: "registered-account-password" }, guest.token)).status, 400)
    assert.equal((await f.post("guest/upgrade", { email: "member@example.test", password: "short" }, guest.token)).status, 400)
    f.state.users.push({ id: 20, email: "member@example.test" })
    assert.equal((await f.post("guest/upgrade", { email: "member@example.test", password: "registered-account-password" }, guest.token)).status, 409)
    assert.equal(f.state.users[0].email, email)
    const unavailable = await fixture(t, { mail: false })
    const another = (await unavailable.guest()).body
    assert.equal((await unavailable.post("guest/upgrade", { email: "member@example.test", password: "registered-account-password" }, another.token)).status, 503)
    assert.equal((await unavailable.post("tokenValid", { token: another.token })).body.user.isGuest, true)
})

test("correcting a pending email requires its password and invalidates both old code types", async t => {
    const f = await fixture(t)
    const guest = (await f.guest()).body
    const password = "registered-account-password"
    const change = { email: "correct@example.test", password }
    assert.equal((await f.post("guest/change-email", change, guest.token)).status, 409)
    await f.post("guest/upgrade", { email: "typo@example.test", password }, guest.token)
    const oldCode = f.state.codes.get(1)
    f.state.recoveryCodes.set(1, { email: "typo@example.test", code: "old-recovery" })
    assert.equal((await f.post("guest/change-email", change)).status, 401)
    assert.equal((await f.post("guest/change-email", { ...change, password: "wrong-password" }, guest.token)).status, 403)
    assert.equal(f.state.users[0].email, "typo@example.test")
    const corrected = await f.post("guest/change-email", change, guest.token)
    assert.equal(corrected.status, 200)
    assert.deepEqual(corrected.body.user, { id: 1, username: "guest_one", email: change.email, isGuest: true, registrationPending: true })
    assert.equal(f.state.recoveryCodes.has(1), false)
    assert.equal((await f.post("email-verification/confirm", { email: "typo@example.test", code })).status, 400)
    assert.equal((await f.post("email-verification/confirm", { email: change.email, code })).status, 400)
    const currentCode = f.state.codes.get(1)
    f.state.codes.set(1, oldCode)
    assert.equal((await f.post("email-verification/confirm", { email: change.email, code })).status, 400, "An in-flight old-address delivery is not usable at the new address")
    f.state.codes.set(1, currentCode)
    assert.equal((await f.post("email-verification/confirm", { email: change.email, code: f.state.emails.at(-1).code })).status, 200)
    assert.equal((await f.post("guest/change-email", change, guest.token)).status, 409)
    assert.equal(f.state.users[0].id, 1)
    assert.equal(f.state.users[0].dm_public_key, "preserved-key")
})

test("occupied email and simultaneous corrections cannot overwrite pending identity or credentials", async t => {
    const f = await fixture(t)
    const guest = (await f.guest()).body
    const password = "registered-account-password"
    await f.post("guest/upgrade", { email: "typo@example.test", password }, guest.token)
    f.state.users.push({ id: 20, email: "taken@example.test" })
    assert.equal((await f.post("guest/change-email", { email: "taken@example.test", password }, guest.token)).status, 409)
    assert.equal(f.state.users[0].email, "typo@example.test")
    const results = await Promise.all(["first", "second"].map(name => f.post("guest/change-email", { email: `${name}@example.test`, password }, guest.token)))
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
    assert.equal(f.state.users[0].email, results.find(result => result.status === 200).body.user.email)
    assert.equal(await bcrypt.compare(password, f.state.users[0].password_hash), true)
})

test("confirmation winning the correction race leaves the registered account unchanged", async t => {
    const f = await fixture(t, { beforeEmailWrite: state => { state.users[0].is_guest = false; state.users[0].guest_registration_pending = false; state.users[0].email_verified_at = new Date() } })
    const guest = (await f.guest()).body
    const password = "registered-account-password"
    await f.post("guest/upgrade", { email: "confirmed@example.test", password }, guest.token)
    assert.equal((await f.post("guest/change-email", { email: "other@example.test", password }, guest.token)).status, 409)
    assert.equal(f.state.users[0].email, "confirmed@example.test")
    assert.equal(f.state.users[0].is_guest, false)
})
