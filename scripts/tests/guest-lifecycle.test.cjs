const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
require("tsx/cjs")

const enabled = process.env.GUEST_LIFECYCLE_TEST_DATABASE === "isolated"
test("guest identity archive, expiry, reuse and competing credential operations", { skip: !enabled }, async t => {
    assert.equal(process.env.PG_DATABASE, "guest_lifecycle_test")
    const { pool, redis } = require("../../apps/shared/config.ts")
    const { revokeGuestDevice, cleanupExpiredGuests, archiveGuestIfInactive, setGuestArchiveListener } = require("../../apps/auth-api/auth/guestLifecycle.ts")
    const { issueRefreshToken } = require("../../apps/auth-api/auth/refreshToken.ts")
    const { rotateRefreshSession, revokeRetryableRefresh, revokeHashedRefresh } = require("../../apps/auth-api/auth/retryableSession.ts")
    const root = path.resolve(__dirname, "../..")
    t.after(async () => { await pool.end(); redis.disconnect() })
    await pool.query(fs.readFileSync(path.join(root, "apps/database/schema.sql"), "utf8"))
    for (const migration of fs.readdirSync(path.join(root, "apps/database/migrations")).sort()) {
        await pool.query(fs.readFileSync(path.join(root, "apps/database/migrations", migration), "utf8"))
    }
    let seq = 0
    async function account({ guest = true, pending = false } = {}) {
        const name = `guest${++seq}`
        return (await pool.query(`INSERT INTO users(username,email,password_hash,is_guest,guest_registration_pending)
            VALUES ($1,$2,'hash',$3,$4) RETURNING id,username,auth_version`, [name, `${name}@test.invalid`, guest, pending])).rows[0]
    }
    async function device(user) {
        const session = { id: user.id, username: user.username, sessionVersion: Number(user.auth_version) }
        const raw = await issueRefreshToken(session)
        return { ...session, raw }
    }
    async function row(id) { return (await pool.query("SELECT * FROM users WHERE id=$1", [id])).rows[0] }
    const notifications = []
    setGuestArchiveListener(async userId => {
        const visible = await row(userId)
        assert.ok(visible.guest_archived_at)
        notifications.push(userId)
    })
    const user = await account()
    const one = await device(user), two = await device(user)
    await pool.query("INSERT INTO messages(sender_id,receiver_id,content) VALUES ($1,$1,'history')", [user.id])
    await revokeGuestDevice(user.id, one.sessionId)
    assert.equal((await row(user.id)).guest_archived_at, null)
    await revokeGuestDevice(user.id, two.sessionId)
    await revokeGuestDevice(user.id, two.sessionId)
    const archived = await row(user.id)
    assert.ok(archived.guest_archived_at)
    assert.equal(archived.guest_original_username, user.username)
    assert.equal(Number(archived.auth_version), 1)
    assert.deepEqual(notifications, [user.id])
    assert.equal((await pool.query("SELECT content FROM messages WHERE sender_id=$1", [user.id])).rows[0].content, "history")
    await pool.query("INSERT INTO users(username,email,password_hash) VALUES ($1,'reuse@test.invalid','hash')", [user.username])
    assert.equal((await pool.query("SELECT former_user_id FROM username_reclaims WHERE username=$1", [user.username])).rows[0].former_user_id, user.id)
    await assert.rejects(issueRefreshToken({ ...one, sessionVersion: 1 }))
    for (const flags of [{ guest: false }, { pending: true }]) {
        const protectedUser = await account(flags), session = await device(protectedUser)
        await revokeGuestDevice(protectedUser.id, session.sessionId)
        assert.equal((await row(protectedUser.id)).guest_archived_at, null)
    }
    const expired = await account(), expSession = await device(expired)
    await pool.query("UPDATE auth_sessions SET expires_at=NOW()-INTERVAL '30 minutes' WHERE id=$1", [expSession.sessionId])
    await cleanupExpiredGuests()
    assert.equal((await row(expired.id)).guest_archived_at, null)
    await pool.query("UPDATE auth_sessions SET expires_at=NOW()-INTERVAL '2 hours' WHERE id=$1", [expSession.sessionId])
    await cleanupExpiredGuests()
    assert.ok((await row(expired.id)).guest_archived_at)
    assert(notifications.includes(expired.id))
    const revokedOld = await account(), revokedOldSession = await device(revokedOld)
    await pool.query("UPDATE auth_sessions SET revoked_at=NOW()-INTERVAL '2 hours' WHERE id=$1", [revokedOldSession.sessionId])
    await cleanupExpiredGuests()
    assert.ok((await row(revokedOld.id)).guest_archived_at)
    const revokedRecent = await account(), revokedRecentSession = await device(revokedRecent)
    await pool.query("UPDATE auth_sessions SET revoked_at=NOW()-INTERVAL '30 minutes' WHERE id=$1", [revokedRecentSession.sessionId])
    await cleanupExpiredGuests()
    assert.equal((await row(revokedRecent.id)).guest_archived_at, null)
    const disabled = await account(), disabledSession = await device(disabled)
    process.env.GUEST_NICKNAME_REUSE_ENABLED = "0"
    try {
        await revokeGuestDevice(disabled.id, disabledSession.sessionId)
        assert.equal((await row(disabled.id)).guest_archived_at, null)
        assert.equal((await row(disabled.id)).username, disabled.username)
        assert.ok((await pool.query("SELECT revoked_at FROM auth_sessions WHERE id=$1", [disabledSession.sessionId])).rows[0].revoked_at)
    } finally { process.env.GUEST_NICKNAME_REUSE_ENABLED = "1" }
    const racing = await account(), raceSession = await device(racing)
    const proof = "a".repeat(64)
    await Promise.allSettled([
        rotateRefreshSession(raceSession.raw, proof, async () => {}),
        revokeRetryableRefresh(raceSession.raw, proof)
    ])
    assert.ok((await row(racing.id)).guest_archived_at)
    const upgrading = await account(), upgradeSession = await device(upgrading)
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        await client.query("UPDATE users SET guest_registration_pending=TRUE WHERE id=$1", [upgrading.id])
        const logout = revokeGuestDevice(upgrading.id, upgradeSession.sessionId)
        await client.query("COMMIT")
        await logout
        assert.equal((await row(upgrading.id)).guest_archived_at, null)
    } finally { client.release() }
    const rollback = await account(), rollbackSession = await device(rollback)
    const tx = await pool.connect()
    try {
        await tx.query("BEGIN")
        await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [rollback.id])
        await tx.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1", [rollbackSession.sessionId])
        assert.equal(await archiveGuestIfInactive(tx, rollback.id, "logout"), true)
        await tx.query("ROLLBACK")
        assert.equal((await row(rollback.id)).username, rollback.username)
        assert.equal((await pool.query("SELECT 1 FROM username_reclaims WHERE username=$1", [rollback.username])).rows.length, 0)
    } finally { tx.release() }
    assert.equal(notifications.includes(rollback.id), false)
    const hashed = await account(), hashedSession = await device(hashed)
    const rotated = await rotateRefreshSession(hashedSession.raw, "b".repeat(64), async () => {})
    const hash = require("node:crypto").createHash("sha256").update(hashedSession.raw).digest("hex")
    await assert.rejects(rotateRefreshSession(hash, "c".repeat(64), async () => {}))
    assert.equal(await revokeHashedRefresh(hash), hashedSession.sessionId)
    assert.ok((await row(hashed.id)).guest_archived_at)
    assert(notifications.includes(hashed.id))
    await assert.rejects(rotateRefreshSession(rotated.refreshToken, "d".repeat(64), async () => {}))
    await revokeHashedRefresh(hash)
    setGuestArchiveListener(undefined)
})
