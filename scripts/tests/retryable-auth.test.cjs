const { test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")
const ts = require("typescript")
const root = path.resolve(__dirname, "../..")
const digest = value => crypto.createHash("sha256").update(value).digest("hex")
const proof = "a".repeat(64), retry = "b".repeat(64)

function fixture() {
    let state = { users: [], devices: [], guests: [], receipts: [] }
    let failAt
    const queries = []
    const pool = { async connect() {
        let before
        return { release() {}, async query(sql, args = []) {
            queries.push(sql)
            if (failAt && sql.startsWith(failAt)) { failAt = undefined; throw new Error("injected storage failure") }
            if (sql === "BEGIN") { before = structuredClone(state); return { rows: [] } }
            if (sql === "ROLLBACK") { state = before; return { rows: [] } }
            if (sql === "COMMIT" || sql.startsWith("SELECT pg_advisory")) return { rows: [] }
            if (sql.startsWith("SELECT r.username")) return { rows: state.guests.filter(r => r.request_key_hash === args[0]).map(r => ({ ...r, user_id: state.devices.find(d => d.id === r.session_id).user_id })) }
            if (sql.startsWith("INSERT INTO users")) {
                if (state.users.some(u => u.username === args[0])) throw Object.assign(new Error("duplicate"), { code: "23505" })
                const user = { id: state.users.length + 1, username: args[0], email: args[1], auth_version: 0, is_guest: true, guest_registration_pending: false, is_blocked: false }
                state.users.push(user); return { rows: [user] }
            }
            if (sql.startsWith("INSERT INTO auth_sessions")) {
                state.devices.push({ id: args[0], user_id: args[1], refresh_token_hash: args[2], session_version: args[3], expires_at: new Date(Date.now() + 86400000), revoked_at: null, unexpired: true })
                return { rows: [{ id: args[0] }] }
            }
            if (sql.startsWith("INSERT INTO auth_guest_receipts")) { state.guests.push({ request_key_hash: args[0], username: args[1], session_id: args[2] }); return { rows: [] } }
            if (sql.startsWith("SELECT id, username")) return { rows: state.users.filter(u => u.id === args[0]) }
            if (sql.startsWith("SELECT id, refresh_token_hash")) return { rows: state.devices.filter(d => d.id === args[0] && d.user_id === args[1]) }
            if (sql.startsWith("SELECT id, user_id")) {
                const receipt = state.receipts.find(r => r.previous_token_hash === args[0] && (args.length < 2 || r.request_key_hash === args[1]))
                return { rows: state.devices.filter(d => d.refresh_token_hash === args[0] || d.id === receipt?.session_id) }
            }
            if (sql.startsWith("SELECT username, is_guest")) return { rows: state.users.filter(u => u.id === args[0]) }
            if (sql.startsWith("SELECT revoked_at IS NULL")) return { rows: state.devices.filter(d => d.user_id === args[0]).map(d => ({ live: !d.revoked_at && d.expires_at > new Date(), recent: true })) }
            if (sql.startsWith("INSERT INTO username_reclaims")) return { rows: [] }
            if (sql.startsWith("UPDATE users SET guest_original_username")) { const user = state.users.find(u => u.id === args[0]); user.guest_original_username = user.username; user.username = args[1]; user.guest_archived_at = new Date(); user.auth_version++; return { rows: [] } }
            if (sql.startsWith("SELECT id FROM users")) return { rows: state.users.filter(u => u.id === args[0]) }
            if (sql.startsWith("UPDATE auth_sessions SET revoked_at")) {
                for (const device of state.devices.filter(d => d.id === args[0] && d.user_id === args[1])) { device.revoked_at = new Date(); device.refresh_token_hash = null }
                return { rows: [] }
            }
            if (sql.startsWith("SELECT request_key_hash")) return { rows: state.receipts.filter(r => r.previous_token_hash === args[0] && r.session_id === args[1]) }
            if (sql.startsWith("UPDATE auth_sessions SET refresh_token_hash")) {
                const device = state.devices.find(d => d.id === args[2]); device.refresh_token_hash = args[0]; return { rows: [{ expires_at: device.expires_at }] }
            }
            if (sql.startsWith("INSERT INTO auth_refresh_receipts")) { state.receipts.push({ previous_token_hash: args[0], request_key_hash: args[1], next_token_hash: args[2], session_id: args[3], unexpired: true }); return { rows: [] } }
            throw new Error(`Unexpected SQL: ${sql}`)
        } }
    } }
    const cache = new Map([[path.join(root, "apps/shared/config.ts"), { pool, JWT_SECRET: "isolated-retry-session-secret" }]])
    function load(file) {
        if (cache.has(file)) return cache.get(file)
        const module = { exports: {} }, scopedRequire = createRequire(file)
        const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText
        new Function("require", "module", "exports", source)(name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name) + ".ts") : scopedRequire(name), module, module.exports)
        cache.set(file, module.exports); return module.exports
    }
    const api = load(path.join(root, "apps/auth-api/auth/retryableSession.ts"))
    let creates = 0
    return {
        ...api, queries,
        get state() { return state }, get creates() { return creates }, fail(prefix) { failAt = prefix },
        guest: (name = "guest_one", key = proof) => api.createGuestSession(name, key, {}, async () => { creates++; return { email: "guest@guest.playtime.invalid", passwordHash: "already-hashed-random-password" } }),
        rotate: (raw, key = retry, guard = async () => {}) => api.rotateRefreshSession(raw, key, guard)
    }
}

test("a lost guest response replays the original identity and raw credential using only hashed durable proof", async () => {
    const f = fixture(), first = await f.guest(), resumed = await f.guest()
    assert.deepEqual(resumed, first)
    assert.equal(f.creates, 1)
    assert.equal(f.state.users.length, 1)
    assert.equal(f.state.devices.length, 1)
    assert.equal(f.state.guests[0].request_key_hash, digest(proof))
    const durable = JSON.stringify(f.state)
    assert(!durable.includes(proof)); assert(!durable.includes(first.refreshToken))
    await assert.rejects(f.guest("other_name"), error => error.status === 409)
    await assert.rejects(f.guest("guest_one", "c".repeat(64)), error => error.code === "23505")
})

test("session or receipt write failures roll back the guest nickname and allow the same proof to retry", async () => {
    for (const statement of ["INSERT INTO auth_sessions", "INSERT INTO auth_guest_receipts", "COMMIT"]) {
        const f = fixture(); f.fail(statement)
        await assert.rejects(f.guest(), /injected storage failure/)
        assert.equal(f.state.users.length, 0); assert.equal(f.state.devices.length, 0); assert.equal(f.state.guests.length, 0)
        assert.equal((await f.guest()).user.id, 1)
    }
})

test("a lost refresh response is repeatable only with its original proof, without extending expiry", async () => {
    const f = fixture(), guest = await f.guest(), first = await f.rotate(guest.refreshToken)
    const expiry = f.state.devices[0].expires_at
    const writes = f.queries.filter(q => q.startsWith("UPDATE auth_sessions")).length
    const replay = await f.rotate(guest.refreshToken)
    assert.deepEqual(replay, first)
    assert.equal(f.state.devices[0].expires_at, expiry)
    assert.equal(f.queries.filter(q => q.startsWith("UPDATE auth_sessions")).length, writes)
    await assert.rejects(f.rotate(guest.refreshToken, "c".repeat(64)), error => error.status === 401)
    await assert.rejects(f.rotateRefreshSession(guest.refreshToken, undefined, async () => {}), error => error.status === 401)
    assert.equal(f.state.devices[0].refresh_token_hash, digest(first.refreshToken))
    assert(!JSON.stringify(f.state).includes(retry))
})

test("superseded guest and refresh receipts never resurrect an older device credential", async () => {
    const f = fixture(), guest = await f.guest(), next = await f.rotate(guest.refreshToken)
    await assert.rejects(f.guest(), error => error.status === 409 && error.retrySuperseded)
    const latest = await f.rotate(next.refreshToken, "c".repeat(64))
    await assert.rejects(f.rotate(guest.refreshToken), error => error.status === 409 && error.retrySuperseded)
    assert.equal(f.state.devices[0].refresh_token_hash, digest(latest.refreshToken))
})

test("receipt or commit failures leave the original refresh usable and transient lock checks do not consume it", async () => {
    for (const statement of ["INSERT INTO auth_refresh_receipts", "COMMIT"]) {
        const f = fixture(), guest = await f.guest(); f.fail(statement)
        await assert.rejects(f.rotate(guest.refreshToken), /injected storage failure/)
        assert.equal(f.state.devices[0].refresh_token_hash, digest(guest.refreshToken)); assert.equal(f.state.receipts.length, 0)
        await assert.rejects(f.rotate(guest.refreshToken, retry, async () => { throw new Error("Redis unavailable") }), /Redis unavailable/)
        assert.equal(f.state.devices[0].refresh_token_hash, digest(guest.refreshToken))
        await f.rotate(guest.refreshToken)
    }
})

test("revocation, expiry, account blocks and password recovery invalidate both recovery paths", async () => {
    for (const mutate of [f => { f.state.devices[0].revoked_at = new Date() }, f => { f.state.devices[0].unexpired = false }, f => { f.state.users[0].is_blocked = true }, f => { f.state.users[0].auth_version++ }]) {
        const f = fixture(), guest = await f.guest(); mutate(f)
        await assert.rejects(f.guest(), error => error.status === 401)
        await assert.rejects(f.rotate(guest.refreshToken), error => error.status === 401)
        const r = fixture(), original = await r.guest(); await r.rotate(original.refreshToken); mutate(r)
        await assert.rejects(r.rotate(original.refreshToken), error => error.status === 401)
    }
})

test("legacy refresh still rotates atomically and cannot replay a consumed token", async () => {
    const f = fixture(), guest = await f.guest()
    const next = await f.rotateRefreshSession(guest.refreshToken, undefined, async () => {})
    assert.notEqual(next.refreshToken, guest.refreshToken)
    assert.equal(f.state.devices[0].refresh_token_hash, digest(next.refreshToken))
    assert.equal(f.state.receipts.length, 0)
    await assert.rejects(f.rotateRefreshSession(guest.refreshToken, undefined, async () => {}), error => error.status === 401)
})

test("logout recovers the rotated device from the old token only with the original request proof", async () => {
    const f = fixture(), guest = await f.guest(), next = await f.rotate(guest.refreshToken)
    await f.revokeRetryableRefresh(guest.refreshToken, "c".repeat(64))
    assert.equal(f.state.devices[0].revoked_at, null)
    await f.revokeRetryableRefresh(guest.refreshToken, retry)
    assert(f.state.devices[0].revoked_at)
    await assert.rejects(f.rotate(guest.refreshToken), error => error.status === 401)
    await assert.rejects(f.rotate(next.refreshToken), error => error.status === 401)
})

test("hashed refresh proof only revokes its own session and cannot authenticate or rotate", async () => {
    const f = fixture(), guest = await f.guest()
    const hash = digest(guest.refreshToken)
    await assert.rejects(f.rotate(hash), error => error.status === 401)
    assert.equal(f.state.devices[0].revoked_at, null)
    const other = await f.guest("other_guest", "c".repeat(64))
    const revokedId = await f.revokeHashedRefresh(hash)
    assert.equal(revokedId, guest.session.sessionId)
    assert(f.state.devices[0].revoked_at)
    assert.equal(f.state.devices[1].revoked_at, null)
    await assert.rejects(f.rotate(guest.refreshToken), error => error.status === 401)
    assert.equal((await f.rotate(other.refreshToken)).user.id, other.user.id)
})

test("hashed logout survives response-lost rotation and is harmless for unknown or malformed proofs", async () => {
    const f = fixture(), guest = await f.guest(), rotated = await f.rotate(guest.refreshToken)
    const before = f.queries.length
    for (const hash of ["", "not-a-hash", "f".repeat(63)]) await f.revokeHashedRefresh(hash)
    assert.equal(f.queries.length, before)
    assert.equal(await f.revokeHashedRefresh("f".repeat(64)), undefined)
    assert.equal(f.state.devices[0].revoked_at, null)
    assert.equal(await f.revokeHashedRefresh(digest(guest.refreshToken)), guest.session.sessionId)
    assert(f.state.devices[0].revoked_at)
    await assert.rejects(f.rotate(rotated.refreshToken), error => error.status === 401)
    await f.revokeHashedRefresh(digest(guest.refreshToken))
})
