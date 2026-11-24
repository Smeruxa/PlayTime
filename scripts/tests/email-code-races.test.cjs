const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")
const ts = require("typescript")
require("tsx/cjs")

const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const recoveryCode = require("../../apps/auth-api/auth/recoveryCode.ts")
const secret = "isolated-email-code-race-secret"
const initialEmail = "typo@example.test"
const correctedEmail = "correct@example.test"

function deferred() {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}

function load(file, replacements) {
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }
    }).outputText
    const loaded = { exports: {} }
    new Function("require", "module", "exports", source)(
        name => Object.hasOwn(replacements, name) ? replacements[name] : backendRequire(name), loaded, loaded.exports
    )
    return loaded.exports
}

function fixture() {
    const state = {
        user: { id: 42, email: initialEmail, email_verified_at: null, is_guest: true, guest_registration_pending: true },
        verification: null, recovery: null, passwordHash: null, revoked: 0, mail: [], reservations: new Map(), released: 0
    }
    let connectGate, onMail, failStage, lockTail = Promise.resolve()
    const pool = {
        async query(sql, args = []) {
            if (failStage === "cleanup") { failStage = undefined; throw new Error("temporary cleanup failure") }
            if (/^DELETE FROM (email_verification_codes|password_recovery) WHERE expires_at/.test(sql)) return { rows: [] }
            if (sql.startsWith("SELECT id, email FROM users")) return { rows: state.user.email === args[0] ? [{ id: state.user.id, email: state.user.email }] : [] }
            throw new Error(`Unexpected pool query: ${sql}`)
        },
        async connect() {
            if (failStage === "connect") { failStage = undefined; throw new Error("temporary connection failure") }
            if (connectGate) {
                const gate = connectGate
                connectGate = undefined
                gate.entered.resolve()
                await gate.resume.promise
            }
            let unlock, locked = false
            async function lockUser() {
                if (locked) return
                const previous = lockTail
                lockTail = new Promise(resolve => { unlock = resolve })
                await previous
                locked = true
            }
            function releaseLock() { if (locked) { locked = false; unlock() } }
            return {
                async query(sql, args = []) {
                    if (sql === "BEGIN") return { rows: [] }
                    if (sql === "COMMIT" || sql === "ROLLBACK") { releaseLock(); return { rows: [] } }
                    if (sql.startsWith("SELECT id FROM users")) {
                        assert.match(sql, /FOR UPDATE/, "Every code operation must first lock its user")
                        await lockUser()
                        const matches = sql.includes("WHERE id=$1")
                            ? state.user.id === args[0] && state.user.email === args[1]
                            : state.user.email === args[0]
                        return { rows: matches && (!sql.includes("email_verified_at IS NULL") || !state.user.email_verified_at) ? [{ id: state.user.id }] : [] }
                    }
                    assert.equal(locked, true, "User lock must be held before reading or changing codes")
                    if (sql === "UPDATE users SET email=$1 WHERE id=$2") { state.user.email = args[0]; return { rows: [] } }
                    if (/^INSERT INTO (email_verification_codes|password_recovery)/.test(sql)) {
                        assert.match(sql, /code_hash, email, expires_at/)
                        const key = sql.includes("email_verification_codes") ? "verification" : "recovery"
                        state[key] = { user_id: args[0], code_hash: args[1], email: args[2], attempts: 0 }
                        return { rows: [] }
                    }
                    if (sql.startsWith("SELECT c.*")) {
                        assert.match(sql, /c\.user_id=\$1 AND c\.email=\$2/)
                        return { rows: state.verification?.user_id === args[0] && state.verification.email === args[1] ? [{ ...state.verification }] : [] }
                    }
                    if (sql.includes("SELECT r.user_id")) {
                        assert.match(sql, /r\.email=\$1 AND r\.user_id=\$2/)
                        return { rows: state.recovery?.email === args[0] && state.recovery.user_id === args[1] ? [{ ...state.recovery }] : [] }
                    }
                    if (sql.startsWith("UPDATE email_verification_codes")) { state.verification.attempts++; return { rows: [] } }
                    if (sql.startsWith("UPDATE password_recovery")) { state.recovery.attempts++; return { rows: [] } }
                    if (sql.startsWith("DELETE FROM email_verification_codes")) { state.verification = null; return { rows: [] } }
                    if (sql.startsWith("DELETE FROM password_recovery")) { state.recovery = null; return { rows: [] } }
                    if (sql.startsWith("UPDATE users SET email_verified_at") || sql.startsWith("UPDATE users SET password_hash")) {
                        if (sql.includes("password_hash")) state.passwordHash = args[0]
                        state.user.email_verified_at = new Date()
                        state.user.is_guest = false
                        state.user.guest_registration_pending = false
                        return { rows: [] }
                    }
                    if (sql.startsWith("UPDATE auth_sessions")) return { rows: [] }
                    throw new Error(`Unexpected client query: ${sql}`)
                },
                release() { releaseLock(); state.released++ }
            }
        }
    }
    const redis = {
        async set(key, value, _ex, _seconds, nx) {
            if (nx && state.reservations.has(key)) return null
            state.reservations.set(key, value)
            return "OK"
        },
        async del(key) { return state.reservations.delete(key) ? 1 : 0 },
        async eval(_script, _count, key, value) {
            if (state.reservations.get(key) !== value) return 0
            return state.reservations.delete(key) ? 1 : 0
        }
    }
    const mail = {
        isRecoveryMailConfigured: () => true,
        async sendRecoveryMail(email, code, kind) {
            const delivery = { email, code, kind }
            state.mail.push(delivery)
            await onMail?.(delivery)
        }
    }
    const config = { pool, redis, JWT_SECRET: secret }
    const limits = { createEmailCodeLimits: () => ({ async canTry() { return true }, async claimDelivery() { return true }, async recordFailure() {} }) }
    const { sendEmailVerification } = load("apps/auth-api/auth/emailVerification.ts", {
        "../../shared/config": config, "./recoveryCode": recoveryCode, "../services/recoveryMail": mail, "./emailCodeLimits": limits
    })
    const routes = new Map()
    const replacements = {
        express: { Router: () => ({ post(route, ...handlers) { routes.set(route, handlers.at(-1)) } }) },
        "../../shared/config": config,
        "../auth/recoveryCode": recoveryCode,
        "../auth/emailCodeLimits": limits,
        "../../shared/auth/passwordPolicy": require("../../apps/shared/auth/passwordPolicy.ts"),
        "../auth/emailVerification": { sendEmailVerification },
        "../auth/sessionVersion": { async revokeUserCredentials() { state.revoked++ } },
        "../services/recoveryMail": mail,
        "../http/authRateLimits": { createAuthRateLimiters: () => ({ loginRegisterLimiter: () => {} }) },
        "express-rate-limit": { __esModule: true, default: () => () => {} },
        "rate-limit-redis": { RedisStore: class {} }
    }
    load("apps/auth-api/routes/emailVerification.ts", replacements)
    load("apps/auth-api/routes/accountRecovery.ts", replacements)
    return {
        state, send: sendEmailVerification,
        failNext(stage) { failStage = stage },
        onMail(callback) { onMail = callback },
        delayNextConnection() {
            const gate = { entered: deferred(), resume: deferred() }
            connectGate = gate
            return gate
        },
        async correctEmail(email) {
            const client = await pool.connect()
            try {
                await client.query("BEGIN")
                await client.query("SELECT id FROM users WHERE email=$1 FOR UPDATE", [state.user.email])
                await client.query("UPDATE users SET email=$1 WHERE id=$2", [email, state.user.id])
                await client.query("DELETE FROM email_verification_codes WHERE user_id=$1", [state.user.id])
                await client.query("DELETE FROM password_recovery WHERE user_id=$1", [state.user.id])
                await client.query("COMMIT")
            } finally { client.release() }
        },
        async post(route, body) {
            const res = { statusCode: 200, body: undefined, headersSent: false, status(value) { this.statusCode = value; return this }, json(value) { this.body = value; this.headersSent = true; return this } }
            await routes.get(route)({ body, app: { get: () => undefined } }, res)
            return { status: res.statusCode, body: res.body }
        }
    }
}

test("a delayed old-address verification worker cannot replace the corrected-address code", async () => {
    const f = fixture()
    const gate = f.delayNextConnection()
    const oldSend = f.send(42, initialEmail)
    await gate.entered.promise
    await f.correctEmail(correctedEmail)
    await f.send(42, correctedEmail, true)
    const current = { ...f.state.verification }
    gate.resume.resolve()
    await oldSend
    assert.deepEqual(f.state.verification, current)
    assert.deepEqual(f.state.mail.map(item => item.email), [correctedEmail])
    assert.equal(current.email, correctedEmail)
    assert.equal(recoveryCode.matchesRecoveryCode(f.state.mail[0].code, current.code_hash, secret + ":email-verification"), true)
})

test("a letter delivered after correction cannot verify either the obsolete or corrected address", async () => {
    const f = fixture()
    const delivered = deferred(), finishDelivery = deferred()
    f.onMail(async delivery => { if (delivery.email === initialEmail) { delivered.resolve(); await finishDelivery.promise } })
    const oldSend = f.send(42, initialEmail)
    await delivered.promise
    const oldCode = f.state.mail[0].code
    await f.correctEmail(correctedEmail)
    await f.send(42, correctedEmail, true)
    finishDelivery.resolve()
    await oldSend
    for (const email of [initialEmail, correctedEmail]) {
        assert.equal((await f.post("/email-verification/confirm", { email, code: oldCode })).status, 400)
    }
    assert.equal(f.state.user.is_guest, true)
    assert.equal((await f.post("/email-verification/confirm", { email: correctedEmail, code: f.state.mail[1].code })).status, 200)
    assert.equal(f.state.user.is_guest, false)
    assert.equal(f.state.user.email, correctedEmail)
})

test("an older SMTP failure cannot clear the new reservation after correcting back to the same address", async () => {
    const f = fixture()
    const delivered = deferred(), failDelivery = deferred()
    let deliveries = 0
    f.onMail(async () => { if (++deliveries === 1) { delivered.resolve(); await failDelivery.promise } })
    const oldSend = f.send(42, initialEmail)
    const oldFailure = assert.rejects(oldSend, /old SMTP failure/)
    await delivered.promise
    await f.correctEmail(correctedEmail)
    await f.correctEmail(initialEmail)
    await f.send(42, initialEmail, true)
    const reservation = [...f.state.reservations.entries()]
    assert.equal(f.state.mail.length, 2, "The correction must send immediately even within the previous cooldown")
    failDelivery.reject(new Error("old SMTP failure"))
    await oldFailure
    assert.deepEqual([...f.state.reservations.entries()], reservation)
    await f.send(42, initialEmail)
    assert.equal(f.state.mail.length, 2, "The new delivery's cooldown must remain in force")
    assert.equal(recoveryCode.matchesRecoveryCode(f.state.mail[1].code, f.state.verification.code_hash, secret + ":email-verification"), true)
})

test("a recovery worker queued before correction rechecks its destination before creating a code", async () => {
    const f = fixture()
    const gate = f.delayNextConnection()
    assert.equal((await f.post("/recovery/request", { email: initialEmail })).status, 200)
    await gate.entered.promise
    await f.correctEmail(correctedEmail)
    const released = f.state.released
    gate.resume.resolve()
    for (let turns = 0; turns < 30 && f.state.released === released; turns++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.state.released, released + 1, "The background recovery worker must finish")
    assert.equal(f.state.recovery, null)
    assert.deepEqual(f.state.mail, [])
})

test("even a stale persisted recovery row cannot reset the password through a corrected address", async () => {
    const f = fixture()
    await f.correctEmail(correctedEmail)
    const code = "012345"
    f.state.recovery = { user_id: 42, email: initialEmail, code_hash: recoveryCode.recoveryCodeHash(code, secret), attempts: 0 }
    for (const email of [initialEmail, correctedEmail]) {
        assert.equal((await f.post("/recovery/reset", { email, code, password: "a-new-account-password" })).status, 400)
    }
    assert.equal(f.state.passwordHash, null)
    assert.equal(f.state.revoked, 0)
    assert.equal(f.state.user.is_guest, true)
    f.state.recovery.email = correctedEmail
    assert.equal((await f.post("/recovery/reset", { email: correctedEmail, code, password: "a-new-account-password" })).status, 200)
    assert.equal(await backendRequire("bcrypt").compare("a-new-account-password", f.state.passwordHash), true)
    assert.equal(f.state.revoked, 1)
    assert.equal(f.state.user.is_guest, false)
    assert.equal(f.state.recovery, null)
})

for (const stage of ["cleanup", "connect"]) {
    test(`a temporary ${stage} failure releases its email reservation so delivery can be retried immediately`, async () => {
        const f = fixture()
        f.failNext(stage)
        await assert.rejects(f.send(42, initialEmail), /temporary/)
        assert.equal(f.state.reservations.size, 0)
        assert.deepEqual(f.state.mail, [])
        await f.send(42, initialEmail)
        assert.equal(f.state.mail.length, 1)
        assert.equal(f.state.verification.email, initialEmail)
    })
}
